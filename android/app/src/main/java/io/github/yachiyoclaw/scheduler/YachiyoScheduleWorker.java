package io.github.yachiyoclaw.scheduler;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.util.concurrent.TimeUnit;

/**
 * Reliable wake stage. Full headless AgentRuntime execution is intentionally not claimed yet:
 * this Worker atomically claims the execution, persists an outbox wake, and asks the foreground
 * bridge to drain it. A future headless runtime can consume the same checkpoint contract.
 */
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
        YachiyoSchedulerStore store = YachiyoSchedulerRuntime.get(getApplicationContext()).store();
        try {
            // WorkManager runs the wake stage as a short foreground service. It never starts the
            // Activity or executes model/tool side effects while the renderer is unavailable.
            setForegroundAsync(
                YachiyoSchedulerNotification.foregroundInfo(getApplicationContext(), executionId)
            ).get(10, TimeUnit.SECONDS);
            // A unique WorkRequest can still race with a reconcile or a package restore. CAS claim
            // makes duplicate workers harmless and increments the durable attempt counter.
            if (!store.claim(scheduleId, executionId, now)) return Result.success();
            if (!store.markAwaitingForeground(scheduleId, executionId, now)) return Result.success();
            YachiyoSchedulerNotification.post(getApplicationContext(), executionId);
            return Result.success();
        } catch (Exception error) {
            store.markRetryableFailure(scheduleId, executionId, error.getClass().getSimpleName(), now);
            return Result.retry();
        }
    }
}

