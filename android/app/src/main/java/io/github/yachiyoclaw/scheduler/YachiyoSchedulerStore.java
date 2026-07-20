package io.github.yachiyoclaw.scheduler;

import android.content.Context;
import com.getcapacitor.JSObject;
import io.github.yachiyoclaw.security.SecureStorageService;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.json.JSONObject;

/**
 * Transactional scheduler repository. It deliberately knows nothing about WorkManager so JVM
 * tests can exercise claim/lease/outbox transitions without a device scheduler.
 */
public final class YachiyoSchedulerStore {
    private static final int MAX_TITLE_LENGTH = 240;
    private static final int MAX_PROMPT_LENGTH = 128 * 1024;
    private static final String PAYLOAD_VERSION = "1";

    private final YachiyoSchedulerDatabase database;
    private final ScheduleDao dao;
    private final SecureStorageService secureStorage;

    public YachiyoSchedulerStore(Context context) {
        database = YachiyoSchedulerDatabase.getInstance(context);
        dao = database.scheduleDao();
        secureStorage = new SecureStorageService();
    }

    public ScheduleSnapshot upsert(
        String id,
        String title,
        String prompt,
        long runAt,
        String repeat,
        boolean enabled,
        boolean exact,
        boolean requiresNetwork,
        String timezone,
        long now
    ) throws Exception {
        String scheduleId = id == null || id.trim().isEmpty() ? UUID.randomUUID().toString() : id.trim();
        String normalizedTitle = normalizeTitle(title, prompt);
        String normalizedPrompt = normalizePrompt(prompt);
        String normalizedRepeat = normalizeRepeat(repeat);
        String normalizedTimezone = timezone == null || timezone.trim().isEmpty() ? "UTC" : timezone.trim();
        if (runAt < 0) throw new IllegalArgumentException("run_at_invalid");

        JSONObject payload = new JSONObject();
        payload.put("version", PAYLOAD_VERSION);
        payload.put("prompt", normalizedPrompt);
        String payloadEnvelope = secureStorage.encrypt(payload.toString());
        ScheduleEntity existing = dao.findSchedule(scheduleId);
        ScheduleEntity schedule = new ScheduleEntity();
        schedule.id = scheduleId;
        schedule.title = normalizedTitle;
        schedule.payloadEnvelope = payloadEnvelope;
        schedule.repeat = normalizedRepeat;
        schedule.status = enabled ? SchedulerState.SCHEDULED : SchedulerState.CANCELLED;
        schedule.timezone = normalizedTimezone;
        schedule.runAt = runAt;
        schedule.nextRunAt = runAt;
        schedule.createdAt = existing == null ? now : existing.createdAt;
        schedule.updatedAt = now;
        schedule.enabled = enabled;
        schedule.exact = exact;
        schedule.requiresNetwork = requiresNetwork;

        ScheduleExecutionEntity execution = newExecution(scheduleId, runAt, enabled ? SchedulerState.SCHEDULED : SchedulerState.CANCELLED);
        schedule.currentExecutionId = execution.id;
        database.runInTransaction(() -> {
            if (existing != null) {
                ScheduleExecutionEntity previous = dao.findExecution(existing.currentExecutionId);
                if (previous != null && !SchedulerPolicy.isTerminal(previous.status)) {
                    dao.setExecutionState(existing.id, previous.id, SchedulerState.CANCELLED, "replaced_by_update");
                    dao.deleteOutbox(existing.id);
                }
            }
            dao.upsertSchedule(schedule);
            dao.upsertExecution(execution);
        });
        return new ScheduleSnapshot(schedule, execution);
    }

    public ScheduleSnapshot runNow(String scheduleId, long now) {
        ScheduleEntity schedule = requireSchedule(scheduleId);
        ScheduleExecutionEntity previous = dao.findExecution(schedule.currentExecutionId);
        schedule.runAt = now;
        schedule.nextRunAt = now;
        schedule.updatedAt = now;
        schedule.enabled = true;
        schedule.status = SchedulerState.SCHEDULED;
        ScheduleExecutionEntity execution = newExecution(schedule.id, now, SchedulerState.SCHEDULED);
        schedule.currentExecutionId = execution.id;
        database.runInTransaction(() -> {
            if (previous != null && !SchedulerPolicy.isTerminal(previous.status)) {
                dao.setExecutionState(schedule.id, previous.id, SchedulerState.CANCELLED, "replaced_by_manual_run");
                dao.deleteOutbox(schedule.id);
            }
            dao.upsertSchedule(schedule);
            dao.upsertExecution(execution);
        });
        return new ScheduleSnapshot(schedule, execution);
    }

    public boolean delete(String scheduleId, long now) {
        if (scheduleId == null || scheduleId.trim().isEmpty()) return false;
        ScheduleEntity schedule = dao.findSchedule(scheduleId);
        if (schedule == null) return false;
        database.runInTransaction(() -> {
            schedule.enabled = false;
            schedule.status = SchedulerState.CANCELLED;
            schedule.updatedAt = now;
            dao.upsertSchedule(schedule);
            ScheduleExecutionEntity execution = dao.findExecution(schedule.currentExecutionId);
            if (execution != null && !isTerminal(execution.status)) {
                dao.setExecutionState(schedule.id, execution.id, SchedulerState.CANCELLED, "cancelled_by_user");
            }
            dao.deleteOutbox(schedule.id);
        });
        return true;
    }

    public List<ScheduleEntity> listSchedules() {
        return dao.listSchedules();
    }

    public ScheduleEntity findSchedule(String scheduleId) {
        return scheduleId == null ? null : dao.findSchedule(scheduleId);
    }

    public ScheduleExecutionEntity findExecution(String executionId) {
        return executionId == null ? null : dao.findExecution(executionId);
    }

    /**
     * Repairs expired leases and returns the durable executions that should have unique WorkRequests.
     * Reconcile is intentionally idempotent: it never creates a second execution for an already
     * scheduled or foreground-pending run.
     */
    public List<ScheduleSnapshot> reconcile(long now) {
        recoverExpiredLeases(now);
        List<ScheduleSnapshot> result = new ArrayList<>();
        for (ScheduleEntity schedule : dao.listSchedules()) {
            if (!schedule.enabled || SchedulerState.CANCELLED.equals(schedule.status)) continue;
            ScheduleExecutionEntity execution = dao.findExecution(schedule.currentExecutionId);
            if (execution == null) {
                ScheduleExecutionEntity replacement = newExecution(schedule.id, schedule.nextRunAt, SchedulerState.SCHEDULED);
                schedule.currentExecutionId = replacement.id;
                schedule.status = SchedulerState.SCHEDULED;
                schedule.updatedAt = now;
                database.runInTransaction(() -> {
                    dao.upsertSchedule(schedule);
                    dao.upsertExecution(replacement);
                });
                result.add(new ScheduleSnapshot(schedule, replacement));
                continue;
            }

            if (SchedulerState.SCHEDULED.equals(execution.status) || SchedulerState.RETRYABLE_FAILED.equals(execution.status)) {
                result.add(new ScheduleSnapshot(schedule, execution));
                continue;
            }

            // A recurring execution may have reached a terminal state before the renderer could
            // create its next run (for example, during a process death).
            if (
                !"once".equals(schedule.repeat) &&
                SchedulerState.SUCCEEDED.equals(execution.status) &&
                schedule.nextRunAt <= now
            ) {
                ScheduleExecutionEntity replacement = newExecution(
                    schedule.id,
                    SchedulerPolicy.nextRunAt(schedule.repeat, schedule.nextRunAt, now),
                    SchedulerState.SCHEDULED
                );
                schedule.nextRunAt = replacement.scheduledAt;
                schedule.runAt = replacement.scheduledAt;
                schedule.currentExecutionId = replacement.id;
                schedule.status = SchedulerState.SCHEDULED;
                schedule.updatedAt = now;
                database.runInTransaction(() -> {
                    dao.upsertSchedule(schedule);
                    dao.upsertExecution(replacement);
                });
                result.add(new ScheduleSnapshot(schedule, replacement));
            }
        }
        return result;
    }

    /** Atomically claims a scheduled execution and advances its attempt counter. */
    public boolean claim(String scheduleId, String executionId, long now) {
        if (isBlank(scheduleId) || isBlank(executionId)) return false;
        final int[] changed = {0};
        database.runInTransaction(() -> changed[0] = dao.claimExecution(
            scheduleId,
            executionId,
            now,
            now + SchedulerState.LEASE_DURATION_MS
        ));
        return changed[0] == 1;
    }

    public boolean markRunning(String scheduleId, String executionId, long now) {
        final int[] changed = {0};
        database.runInTransaction(() -> changed[0] = dao.markExecutionRunning(
            scheduleId,
            executionId,
            SchedulerState.RUNNING,
            now
        ));
        return changed[0] == 1;
    }

    /**
     * First-phase handoff: the Worker records a durable wake event and leaves execution pending
     * until a foreground renderer drains and acknowledges it.
     */
    public boolean markAwaitingForeground(String scheduleId, String executionId, long now) {
        ScheduleEntity schedule = dao.findSchedule(scheduleId);
        if (schedule == null) return false;
        final boolean[] changed = {false};
        database.runInTransaction(() -> {
            ScheduleExecutionEntity execution = dao.findExecution(executionId);
            if (execution == null || !schedule.id.equals(execution.scheduleId)) return;
            if (!SchedulerState.CLAIMED.equals(execution.status) && !SchedulerState.RUNNING.equals(execution.status)) return;
            if (dao.setExecutionState(scheduleId, executionId, SchedulerState.AWAITING_FOREGROUND, "headless_execution_pending") != 1) return;

            JSONObject event = new JSONObject();
            try {
                event.put("schemaVersion", SchedulerState.SCHEMA_VERSION);
                event.put("eventType", SchedulerState.OUTBOX_WAKE);
                event.put("scheduleId", scheduleId);
                event.put("executionId", executionId);
                event.put("title", schedule.title);
                event.put("runAt", schedule.runAt);
                event.put("status", SchedulerState.AWAITING_FOREGROUND);
                event.put("headlessPending", true);
            } catch (Exception ignored) {
                return;
            }
            ScheduleOutboxEntity outbox = new ScheduleOutboxEntity();
            outbox.id = "wake:" + executionId;
            outbox.scheduleId = scheduleId;
            outbox.executionId = executionId;
            outbox.eventType = SchedulerState.OUTBOX_WAKE;
            outbox.payloadJson = event.toString();
            outbox.createdAt = now;
            dao.insertOutbox(outbox);
            schedule.status = SchedulerState.AWAITING_FOREGROUND;
            schedule.updatedAt = now;
            dao.upsertSchedule(schedule);
            changed[0] = true;
        });
        return changed[0];
    }

    /** Converts an expired lease to a retryable state; no side effect is replayed automatically. */
    public int recoverExpiredLeases(long now) {
        final int[] changed = {0};
        database.runInTransaction(() -> changed[0] = dao.recoverExpiredLeases(now, "lease_expired"));
        return changed[0];
    }

    public boolean markRetryableFailure(String scheduleId, String executionId, String error, long now) {
        ScheduleExecutionEntity execution = dao.findExecution(executionId);
        if (execution == null || !scheduleId.equals(execution.scheduleId)) return false;
        String safeError = sanitizeError(error);
        String nextState = execution.attempt >= SchedulerState.MAX_ATTEMPTS
            ? SchedulerState.PERMANENT_FAILED
            : SchedulerState.RETRYABLE_FAILED;
        final boolean[] changed = {false};
        database.runInTransaction(() -> {
            if (dao.setExecutionState(scheduleId, executionId, nextState, safeError) != 1) return;
            if (SchedulerState.PERMANENT_FAILED.equals(nextState)) {
                insertFailureOutbox(scheduleId, executionId, safeError, now);
            }
            changed[0] = true;
        });
        return changed[0];
    }

    /**
     * Claims outbox rows for a foreground renderer. A delivery lease expires after a process death,
     * so an event is at-least-once and must be acknowledged idempotently.
     */
    public List<JSONObject> drain(int limit, long now) throws Exception {
        int boundedLimit = Math.max(1, Math.min(limit, 50));
        String token = UUID.randomUUID().toString();
        List<ScheduleOutboxEntity> candidates = dao.findClaimableOutbox(now, boundedLimit);
        List<JSONObject> result = new ArrayList<>();
        for (ScheduleOutboxEntity candidate : candidates) {
            if (dao.claimOutbox(candidate.id, token, now, now + SchedulerState.OUTBOX_LEASE_DURATION_MS) != 1) continue;
            ScheduleEntity schedule = dao.findSchedule(candidate.scheduleId);
            ScheduleExecutionEntity execution = dao.findExecution(candidate.executionId);
            if (schedule == null || execution == null) continue;
            JSONObject payload = new JSONObject(secureStorage.decrypt(schedule.payloadEnvelope));
            JSONObject event = new JSONObject(candidate.payloadJson);
            event.put("deliveryId", candidate.id);
            event.put("deliveryToken", token);
            event.put("prompt", payload.optString("prompt", ""));
            event.put("repeat", schedule.repeat);
            event.put("enabled", schedule.enabled);
            event.put("timezone", schedule.timezone);
            event.put("attempt", execution.attempt);
            result.add(event);
        }
        return result;
    }

    /**
     * Commits the foreground handoff before any Agent side effect. Consuming the outbox here makes
     * a process death leave a visible running checkpoint instead of replaying an unknown action.
     */
    public boolean beginForeground(
        String deliveryId,
        String deliveryToken,
        String scheduleId,
        String executionId,
        String checkpointJson,
        long now
    ) {
        if (isBlank(deliveryId) || isBlank(deliveryToken) || isBlank(scheduleId) || isBlank(executionId)) {
            throw new IllegalArgumentException("invalid_foreground_handoff");
        }
        ScheduleOutboxEntity outbox = dao.findOutbox(deliveryId);
        ScheduleExecutionEntity execution = dao.findExecution(executionId);
        if (
            outbox == null || execution == null ||
            !scheduleId.equals(outbox.scheduleId) || !executionId.equals(outbox.executionId) ||
            !scheduleId.equals(execution.scheduleId) || !deliveryToken.equals(outbox.deliveryToken)
        ) {
            throw new IllegalArgumentException("delivery_token_invalid");
        }
        if (outbox.delivered && SchedulerState.RUNNING.equals(execution.status)) return true;
        if (outbox.delivered || !SchedulerState.AWAITING_FOREGROUND.equals(execution.status)) {
            throw new IllegalArgumentException("foreground_handoff_not_pending");
        }
        String safeCheckpoint = clampJson(checkpointJson, 64 * 1024);
        final boolean[] applied = {false};
        database.runInTransaction(() -> {
            if (dao.beginForegroundExecution(scheduleId, executionId, safeCheckpoint, now) != 1) return;
            if (dao.markOutboxDelivered(deliveryId, deliveryToken, now) != 1) {
                throw new IllegalStateException("foreground_outbox_commit_failed");
            }
            ScheduleEntity schedule = dao.findSchedule(scheduleId);
            if (schedule != null) {
                schedule.status = SchedulerState.RUNNING;
                schedule.updatedAt = now;
                dao.upsertSchedule(schedule);
            }
            applied[0] = true;
        });
        if (!applied[0]) throw new IllegalArgumentException("foreground_handoff_not_pending");
        return true;
    }

    /** Acknowledge a foreground handoff and, for repeating schedules, create the next execution. */
    public ScheduleSnapshot acknowledge(
        String deliveryId,
        String deliveryToken,
        String scheduleId,
        String executionId,
        String status,
        String error,
        String checkpointJson,
        String resultJson,
        long now
    ) throws Exception {
        if (isBlank(scheduleId) || isBlank(executionId) || !isAllowedAcknowledgement(status)) {
            throw new IllegalArgumentException("invalid_acknowledgement");
        }
        ScheduleEntity schedule = requireSchedule(scheduleId);
        ScheduleExecutionEntity execution = dao.findExecution(executionId);
        if (execution == null || !schedule.id.equals(execution.scheduleId)) throw new IllegalArgumentException("execution_not_found");
        ScheduleOutboxEntity outbox = isBlank(deliveryId) ? null : dao.findOutbox(deliveryId);
        if (outbox != null && (
            !executionId.equals(outbox.executionId) ||
            isBlank(deliveryToken) ||
            !deliveryToken.equals(outbox.deliveryToken)
        )) {
            throw new IllegalArgumentException("delivery_token_invalid");
        }
        // A delivered terminal execution is an idempotent duplicate acknowledgement. Do not
        // create a second recurring execution or replay a side effect.
        if (isTerminal(execution.status)) {
            if (execution.status.equals(status)) {
                if (outbox != null && !outbox.delivered) {
                    database.runInTransaction(() -> dao.markOutboxDelivered(outbox.id, outbox.deliveryToken, now));
                }
                return null;
            }
            throw new IllegalArgumentException("execution_already_finished");
        }
        if (outbox != null && outbox.delivered) {
            throw new IllegalArgumentException("delivery_already_consumed");
        }

        String safeError = sanitizeError(error);
        String safeCheckpoint = clampJson(checkpointJson, 64 * 1024);
        String safeResult = clampJson(resultJson, 128 * 1024);
        final ScheduleSnapshot[] next = {null};
        final boolean[] applied = {false};
        database.runInTransaction(() -> {
            if (dao.acknowledgeExecution(scheduleId, executionId, status, safeError) != 1) return;
            applied[0] = true;
            ScheduleExecutionEntity updated = dao.findExecution(executionId);
            if (updated != null) {
                updated.checkpointJson = safeCheckpoint;
                updated.resultJson = safeResult;
                if (isTerminal(status)) updated.finishedAt = now;
                dao.upsertExecution(updated);
            }
            if (outbox != null) dao.markOutboxDelivered(outbox.id, outbox.deliveryToken, now);

            if (SchedulerState.SUCCEEDED.equals(status) && schedule.enabled && !"once".equals(schedule.repeat)) {
                long nextRun = SchedulerPolicy.nextRunAt(schedule.repeat, schedule.nextRunAt, now);
                schedule.runAt = nextRun;
                schedule.nextRunAt = nextRun;
                schedule.status = SchedulerState.SCHEDULED;
                schedule.updatedAt = now;
                ScheduleExecutionEntity nextExecution = newExecution(schedule.id, nextRun, SchedulerState.SCHEDULED);
                schedule.currentExecutionId = nextExecution.id;
                dao.upsertSchedule(schedule);
                dao.upsertExecution(nextExecution);
                next[0] = new ScheduleSnapshot(schedule, nextExecution);
            } else if (SchedulerState.SUCCEEDED.equals(status) || SchedulerState.CANCELLED.equals(status) || SchedulerState.PERMANENT_FAILED.equals(status)) {
                schedule.status = status;
                if ("once".equals(schedule.repeat) || !SchedulerState.SUCCEEDED.equals(status)) schedule.enabled = false;
                schedule.updatedAt = now;
                dao.upsertSchedule(schedule);
            } else {
                schedule.status = status;
                schedule.updatedAt = now;
                dao.upsertSchedule(schedule);
            }
        });
        if (!applied[0]) throw new IllegalArgumentException("execution_not_pending");
        return next[0];
    }

    public JSObject toJson(ScheduleEntity schedule) throws Exception {
        JSObject result = new JSObject();
        result.put("schemaVersion", SchedulerState.SCHEMA_VERSION);
        result.put("id", schedule.id);
        result.put("title", schedule.title);
        result.put("prompt", new JSONObject(secureStorage.decrypt(schedule.payloadEnvelope)).optString("prompt", ""));
        result.put("runAt", schedule.runAt);
        result.put("nextRunAt", schedule.nextRunAt);
        result.put("repeat", schedule.repeat);
        result.put("enabled", schedule.enabled);
        result.put("exact", schedule.exact);
        result.put("requiresNetwork", schedule.requiresNetwork);
        result.put("timezone", schedule.timezone);
        result.put("status", schedule.status);
        result.put("currentExecutionId", schedule.currentExecutionId);
        result.put("createdAt", schedule.createdAt);
        result.put("updatedAt", schedule.updatedAt);
        return result;
    }

    public JSObject toExecutionJson(ScheduleExecutionEntity execution) {
        JSObject result = new JSObject();
        result.put("id", execution.id);
        result.put("scheduleId", execution.scheduleId);
        result.put("status", execution.status);
        result.put("attempt", execution.attempt);
        result.put("scheduledAt", execution.scheduledAt);
        result.put("claimedAt", execution.claimedAt);
        result.put("leaseExpiresAt", execution.leaseExpiresAt);
        result.put("startedAt", execution.startedAt);
        result.put("finishedAt", execution.finishedAt);
        result.put("lastError", execution.lastError);
        result.put("checkpoint", execution.checkpointJson);
        return result;
    }

    private void insertFailureOutbox(String scheduleId, String executionId, String error, long now) {
        try {
            ScheduleOutboxEntity outbox = new ScheduleOutboxEntity();
            outbox.id = "failure:" + executionId;
            outbox.scheduleId = scheduleId;
            outbox.executionId = executionId;
            outbox.eventType = "schedule_failed";
            JSONObject payload = new JSONObject();
            payload.put("schemaVersion", SchedulerState.SCHEMA_VERSION);
            payload.put("eventType", "schedule_failed");
            payload.put("scheduleId", scheduleId);
            payload.put("executionId", executionId);
            payload.put("status", SchedulerState.PERMANENT_FAILED);
            payload.put("error", error);
            outbox.payloadJson = payload.toString();
            outbox.createdAt = now;
            dao.insertOutbox(outbox);
        } catch (Exception ignored) {
            // Failure notification is best effort; the terminal execution state remains durable.
        }
    }

    private ScheduleEntity requireSchedule(String scheduleId) {
        ScheduleEntity schedule = dao.findSchedule(scheduleId);
        if (schedule == null) throw new IllegalArgumentException("schedule_not_found");
        return schedule;
    }

    private static ScheduleExecutionEntity newExecution(String scheduleId, long scheduledAt, String status) {
        ScheduleExecutionEntity execution = new ScheduleExecutionEntity();
        execution.id = UUID.randomUUID().toString();
        execution.scheduleId = scheduleId;
        execution.scheduledAt = scheduledAt;
        execution.status = status;
        return execution;
    }

    private static String normalizeTitle(String title, String prompt) {
        String normalized = title == null ? "" : title.trim();
        if (normalized.isEmpty()) normalized = normalizePrompt(prompt).substring(0, Math.min(24, normalizePrompt(prompt).length()));
        if (normalized.length() > MAX_TITLE_LENGTH) normalized = normalized.substring(0, MAX_TITLE_LENGTH);
        return normalized;
    }

    private static String normalizePrompt(String prompt) {
        if (prompt == null || prompt.trim().isEmpty()) throw new IllegalArgumentException("prompt_required");
        String normalized = prompt.trim();
        if (normalized.length() > MAX_PROMPT_LENGTH) throw new IllegalArgumentException("prompt_too_large");
        return normalized;
    }

    private static String normalizeRepeat(String repeat) {
        String value = repeat == null ? "once" : repeat.trim().toLowerCase();
        if (!"once".equals(value) && !"daily".equals(value) && !"weekly".equals(value)) {
            throw new IllegalArgumentException("repeat_invalid");
        }
        return value;
    }

    private static boolean isTerminal(String status) {
        return SchedulerPolicy.isTerminal(status);
    }

    private static boolean isAllowedAcknowledgement(String status) {
        return SchedulerState.SUCCEEDED.equals(status) || SchedulerState.PAUSED.equals(status) ||
            SchedulerState.AWAITING_APPROVAL.equals(status) || SchedulerState.RETRYABLE_FAILED.equals(status) ||
            SchedulerState.PERMANENT_FAILED.equals(status) || SchedulerState.CANCELLED.equals(status);
    }

    private static String sanitizeError(String value) {
        if (value == null) return "";
        String normalized = value.replace('\u0000', ' ').trim();
        if (normalized.length() > 1_024) normalized = normalized.substring(0, 1_024);
        return normalized;
    }

    private static String clampJson(String value, int maxLength) {
        if (value == null || value.trim().isEmpty()) return "{}";
        String normalized = value.trim();
        try {
            new JSONObject(normalized);
        } catch (Exception ignored) {
            return "{}";
        }
        return normalized.length() > maxLength ? "{}" : normalized;
    }

    private static boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }
}


