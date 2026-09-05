package io.github.yachiyoclaw.scheduler;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.util.concurrent.TimeUnit;

/** Runs a bounded native Agent loop when its encrypted runtime snapshot permits headless work. */
public final class YachiyoScheduleWorker extends Worker {
    public static final String KEY_SCHEDULE_ID = "scheduleId";
    public static final String KEY_EXECUTION_ID = "executionId";
    public static final String TAG = "yachiyo-scheduler";

    public YachiyoScheduleWorker(@NonNull Context context, @NonNull WorkerParameters workerParams) {
        super(context, workerParams);
    }

    @NonNull
    @Override
    public Result doWork() {
        String scheduleId = getInputData().getString(KEY_SCHEDULE_ID);
        String executionId = getInputData().getString(KEY_EXECUTION_ID);
        if (scheduleId == null || scheduleId.trim().isEmpty() || executionId == null || executionId.trim().isEmpty()) {
            return Result.failure();
        }

        long now = System.currentTimeMillis();
        YachiyoSchedulerRuntime scheduler = YachiyoSchedulerRuntime.get(getApplicationContext());
        YachiyoSchedulerStore store = scheduler.store();
        try {
            setForegroundAsync(
                YachiyoSchedulerNotification.foregroundInfo(getApplicationContext(), executionId)
            ).get(10, TimeUnit.SECONDS);
            // A unique WorkRequest can still race with a reconcile or a package restore. CAS claim
            // makes duplicate workers harmless and increments the durable attempt counter.
            if (!store.claim(scheduleId, executionId, now)) return Result.success();
            org.json.JSONObject runtime = store.runtimePayload(scheduleId);
            if (runtime == null) return handoff(store, scheduleId, executionId, now);
            if (!store.markRunning(scheduleId, executionId, now)) return Result.success();
            HeadlessAgentRuntime agent = new HeadlessAgentRuntime(
                getApplicationContext(),
                executionId,
                runtime,
                checkpoint -> {
                    if (!store.checkpoint(scheduleId, executionId, checkpoint, System.currentTimeMillis())) {
                        throw new IllegalStateException("headless_execution_lease_lost");
                    }
                }
            );
            HeadlessAgentRuntime.Result result = agent.execute(store.promptPayload(scheduleId));
            org.json.JSONObject checkpoint = new org.json.JSONObject()
                .put("version", 1).put("stage", "completed").put("steps", result.steps())
                .put("updatedAt", System.currentTimeMillis());
            scheduler.completeHeadless(scheduleId, executionId, checkpoint, result.toJson(), System.currentTimeMillis());
            return Result.success();
        } catch (HeadlessAgentRuntime.ForegroundRequiredException foreground) {
            return handoff(store, scheduleId, executionId, System.currentTimeMillis());
        } catch (Exception error) {
            store.markRetryableFailure(scheduleId, executionId, error.getClass().getSimpleName(), now);
            return Result.retry();
        }
    }

    private Result handoff(YachiyoSchedulerStore store, String scheduleId, String executionId, long now) {
        if (!store.markAwaitingForeground(scheduleId, executionId, now)) return Result.success();
        YachiyoSchedulerNotification.post(getApplicationContext(), executionId);
        return Result.success();
    }
}
