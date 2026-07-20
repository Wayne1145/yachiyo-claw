package io.github.yachiyoclaw.scheduler;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

/** Typed Capacitor bridge for the durable native scheduler. */
@CapacitorPlugin(name = "YachiyoScheduler")
public final class YachiyoSchedulerPlugin extends Plugin {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private volatile YachiyoSchedulerRuntime runtime;

    @Override
    public void load() {
        super.load();
        runtime = YachiyoSchedulerRuntime.get(getContext());
        executor.execute(() -> {
            try {
                runtime.reconcile(System.currentTimeMillis());
            } catch (Exception ignored) {
                // Renderer can retry reconciliation explicitly; no secrets are logged here.
            }
        });
    }

    @PluginMethod
    public void list(PluginCall call) {
        executor.execute(() -> {
            try {
                JSObject result = new JSObject();
                JSONArray schedules = new JSONArray();
                for (ScheduleEntity schedule : scheduler().store().listSchedules()) {
                    schedules.put(scheduler().store().toJson(schedule));
                }
                result.put("schemaVersion", SchedulerState.SCHEMA_VERSION);
                result.put("schedules", schedules);
                result.put("headlessExecution", false);
                result.put("pendingState", SchedulerState.AWAITING_FOREGROUND);
                call.resolve(result);
            } catch (Exception error) {
                reject(call, "list", error);
            }
        });
    }

    @PluginMethod
    public void upsert(PluginCall call) {
        JSONObject data = call.getData();
        String prompt = data.optString("prompt", "");
        long runAt = data.optLong("runAt", -1L);
        String id = optionalString(data, "id");
        String title = data.optString("title", "");
        String repeat = data.optString("repeat", "once");
        boolean enabled = !data.has("enabled") || data.optBoolean("enabled", true);
        boolean exact = data.optBoolean("exact", false);
        boolean requiresNetwork = data.optBoolean("requiresNetwork", false);
        String timezone = data.optString("timezone", "UTC");
        executor.execute(() -> {
            try {
                ScheduleSnapshot snapshot = scheduler().upsert(
                    id,
                    title,
                    prompt,
                    runAt,
                    repeat,
                    enabled,
                    exact,
                    requiresNetwork,
                    timezone,
                    System.currentTimeMillis()
                );
                resolveSnapshot(call, snapshot);
                notifyStatus(snapshot);
            } catch (Exception error) {
                reject(call, "upsert", error);
            }
        });
    }

    @PluginMethod
    public void run(PluginCall call) {
        String id = optionalString(call.getData(), "id");
        if (id == null) {
            call.reject("Schedule id is required.", "SCHEDULER_INVALID_INPUT");
            return;
        }
        executor.execute(() -> {
            try {
                ScheduleSnapshot snapshot = scheduler().runNow(id, System.currentTimeMillis());
                resolveSnapshot(call, snapshot);
                notifyStatus(snapshot);
            } catch (Exception error) {
                reject(call, "run", error);
            }
        });
    }

    @PluginMethod
    public void delete(PluginCall call) {
        String id = optionalString(call.getData(), "id");
        if (id == null) {
            call.reject("Schedule id is required.", "SCHEDULER_INVALID_INPUT");
            return;
        }
        executor.execute(() -> {
            try {
                boolean deleted = scheduler().delete(id, System.currentTimeMillis());
                JSObject result = new JSObject();
                result.put("id", id);
                result.put("deleted", deleted);
                call.resolve(result);
            } catch (Exception error) {
                reject(call, "delete", error);
            }
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        delete(call);
    }

    @PluginMethod
    public void reconcile(PluginCall call) {
        executor.execute(() -> {
            try {
                JSObject result = new JSObject(scheduler().reconcile(System.currentTimeMillis()).toString());
                call.resolve(result);
            } catch (Exception error) {
                reject(call, "reconcile", error);
            }
        });
    }

    /** Drains at-least-once wake events; the renderer must acknowledge each delivery token. */
    @PluginMethod
    public void drain(PluginCall call) {
        int limit = call.getData().optInt("limit", 20);
        executor.execute(() -> {
            try {
                List<JSONObject> events = scheduler().drain(limit, System.currentTimeMillis());
                JSObject result = new JSObject();
                JSONArray rows = new JSONArray();
                for (JSONObject event : events) rows.put(event);
                result.put("schemaVersion", SchedulerState.SCHEMA_VERSION);
                result.put("events", rows);
                call.resolve(result);
                if (events.isEmpty()) return;
                JSObject available = new JSObject();
                available.put("count", events.size());
                available.put("schemaVersion", SchedulerState.SCHEMA_VERSION);
                notifyListeners("outboxAvailable", available, true);
            } catch (Exception error) {
                reject(call, "drain", error);
            }
        });
    }

    @PluginMethod
    public void beginForeground(PluginCall call) {
        JSONObject data = call.getData();
        String deliveryId = optionalString(data, "deliveryId");
        String deliveryToken = optionalString(data, "deliveryToken");
        String scheduleId = optionalString(data, "scheduleId");
        String executionId = optionalString(data, "executionId");
        if (deliveryId == null || deliveryToken == null || scheduleId == null || executionId == null) {
            call.reject("Foreground handoff identifiers are required.", "SCHEDULER_INVALID_INPUT");
            return;
        }
        executor.execute(() -> {
            try {
                boolean started = scheduler().beginForeground(
                    deliveryId,
                    deliveryToken,
                    scheduleId,
                    executionId,
                    data.optString("checkpoint", "{}"),
                    System.currentTimeMillis()
                );
                JSObject result = new JSObject();
                result.put("started", started);
                result.put("scheduleId", scheduleId);
                result.put("executionId", executionId);
                result.put("status", SchedulerState.RUNNING);
                call.resolve(result);
            } catch (Exception error) {
                reject(call, "begin_foreground", error);
            }
        });
    }

    @PluginMethod
    public void acknowledge(PluginCall call) {
        JSONObject data = call.getData();
        String scheduleId = optionalString(data, "scheduleId");
        String executionId = optionalString(data, "executionId");
        String status = data.optString("status", "succeeded");
        if (scheduleId == null || executionId == null) {
            call.reject("Schedule and execution ids are required.", "SCHEDULER_INVALID_INPUT");
            return;
        }
        executor.execute(() -> {
            try {
                ScheduleSnapshot next = scheduler().acknowledge(
                    optionalString(data, "deliveryId"),
                    optionalString(data, "deliveryToken"),
                    scheduleId,
                    executionId,
                    status,
                    data.optString("error", ""),
                    data.optString("checkpoint", "{}"),
                    data.optString("result", "{}"),
                    System.currentTimeMillis()
                );
                JSObject result = new JSObject();
                result.put("acknowledged", true);
                result.put("status", status);
                result.put("headlessExecution", false);
                if (next != null) result.put("next", snapshotJson(next));
                call.resolve(result);
            } catch (Exception error) {
                reject(call, "acknowledge", error);
            }
        });
    }

    /** One-time migration entry point for the legacy renderer localStorage schedule array. */
    @PluginMethod
    public void migrateLegacy(PluginCall call) {
        JSONArray tasks = call.getData().optJSONArray("tasks");
        if (tasks == null) {
            call.reject("Legacy tasks are required.", "SCHEDULER_INVALID_INPUT");
            return;
        }
        executor.execute(() -> {
            int imported = 0;
            JSONArray errors = new JSONArray();
            for (int index = 0; index < tasks.length(); index++) {
                try {
                    JSONObject task = tasks.getJSONObject(index);
                    scheduler().upsert(
                        optionalString(task, "id"),
                        task.optString("title", ""),
                        task.optString("prompt", ""),
                        task.optLong("runAt", -1L),
                        task.optString("repeat", "once"),
                        task.optBoolean("enabled", true),
                        false,
                        false,
                        "UTC",
                        System.currentTimeMillis()
                    );
                    imported++;
                } catch (Exception error) {
                    errors.put(index);
                }
            }
            JSObject result = new JSObject();
            result.put("schemaVersion", SchedulerState.SCHEMA_VERSION);
            result.put("imported", imported);
            result.put("errors", errors);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void capabilities(PluginCall call) {
        JSObject result = new JSObject();
        result.put("schemaVersion", SchedulerState.SCHEMA_VERSION);
        result.put("workManager", true);
        result.put("roomStore", true);
        result.put("executionMode", "foreground-required");
        result.put("wakeMode", "workmanager-foreground-service");
        result.put("headlessExecution", false);
        result.put("backgroundAgentRuntime", false);
        result.put("foregroundDrain", true);
        result.put("durableForegroundHandoff", true);
        result.put("bootRecovery", true);
        result.put("lockedBootDeferredUntilUnlock", true);
        result.put("packageReplaceRecovery", true);
        result.put("clockChangeRecovery", true);
        result.put("forceStopRecovery", false);
        result.put("approvalReplay", false);
        result.put("sideEffectReplay", false);
        result.put("pendingState", SchedulerState.AWAITING_FOREGROUND);
        call.resolve(result);
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    private YachiyoSchedulerRuntime scheduler() {
        YachiyoSchedulerRuntime result = runtime;
        return result != null ? result : YachiyoSchedulerRuntime.get(getContext());
    }

    private void resolveSnapshot(PluginCall call, ScheduleSnapshot snapshot) throws Exception {
        call.resolve(snapshotJson(snapshot));
    }

    private JSObject snapshotJson(ScheduleSnapshot snapshot) throws Exception {
        JSObject result = scheduler().store().toJson(snapshot.schedule);
        result.put("execution", scheduler().store().toExecutionJson(snapshot.execution));
        return result;
    }

    private void notifyStatus(ScheduleSnapshot snapshot) {
        try {
            notifyListeners("scheduleStatusChanged", snapshotJson(snapshot), true);
        } catch (Exception ignored) {}
    }

    private static String optionalString(JSONObject data, String key) {
        if (data == null || !data.has(key) || data.isNull(key)) return null;
        String value = data.optString(key, "").trim();
        return value.isEmpty() ? null : value;
    }

    private static void reject(PluginCall call, String operation, Exception error) {
        String message = error instanceof IllegalArgumentException ? error.getMessage() : "scheduler_" + operation + "_failed";
        if (message == null || message.trim().isEmpty()) message = "scheduler_" + operation + "_failed";
        call.reject(message, "SCHEDULER_" + operation.toUpperCase() + "_FAILED");
    }
}

