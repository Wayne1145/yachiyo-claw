package io.github.yachiyoclaw.scheduler;

import android.content.Context;
import androidx.work.Constraints;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/** Native scheduler facade shared by the Capacitor plugin, Worker and boot receiver. */
public final class YachiyoSchedulerRuntime {
    public static final String UNIQUE_WORK_PREFIX = "yachiyo-schedule:";
    private static volatile YachiyoSchedulerRuntime instance;

    private final Context context;
    private final YachiyoSchedulerStore store;

    private YachiyoSchedulerRuntime(Context context) {
        this.context = context.getApplicationContext();
        this.store = new YachiyoSchedulerStore(this.context);
    }

    public static YachiyoSchedulerRuntime get(Context context) {
        YachiyoSchedulerRuntime result = instance;
        if (result != null) return result;
        synchronized (YachiyoSchedulerRuntime.class) {
            result = instance;
            if (result == null) {
                result = new YachiyoSchedulerRuntime(context);
                instance = result;
            }
            return result;
        }
    }

    public YachiyoSchedulerStore store() {
        return store;
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
        ScheduleSnapshot snapshot = store.upsert(
            id,
            title,
            prompt,
            runAt,
            repeat,
            enabled,
            exact,
            requiresNetwork,
            timezone,
            now
        );
        if (enabled) enqueue(snapshot, ExistingWorkPolicy.REPLACE, now);
        else cancelWork(snapshot.schedule.id);
        return snapshot;
    }

    public ScheduleSnapshot runNow(String id, long now) {
        ScheduleSnapshot snapshot = store.runNow(id, now);
        enqueue(snapshot, ExistingWorkPolicy.REPLACE, now);
        return snapshot;
    }

    public boolean delete(String id, long now) {
        boolean deleted = store.delete(id, now);
        if (deleted) cancelWork(id);
        return deleted;
    }

    public JSONObject reconcile(long now) throws Exception {
        return reconcile(now, ExistingWorkPolicy.KEEP);
    }

    public JSONObject reconcileAfterSystemEvent(long now, boolean replaceExistingWork) throws Exception {
        return reconcile(now, replaceExistingWork ? ExistingWorkPolicy.REPLACE : ExistingWorkPolicy.KEEP);
    }

    private JSONObject reconcile(long now, ExistingWorkPolicy policy) throws Exception {
        int recoveredLeases = store.recoverExpiredLeases(now);
        List<ScheduleSnapshot> snapshots = store.reconcile(now);
        int enqueued = 0;
        for (ScheduleSnapshot snapshot : snapshots) {
            if (snapshot.schedule.enabled) {
                enqueue(snapshot, policy, now);
                enqueued++;
            }
        }
        JSONObject result = new JSONObject();
        result.put("schemaVersion", SchedulerState.SCHEMA_VERSION);
        result.put("recoveredLeases", recoveredLeases);
        result.put("enqueued", enqueued);
        result.put("headlessExecution", false);
        result.put("pendingState", SchedulerState.AWAITING_FOREGROUND);
        result.put("executionMode", "foreground-required");
        return result;
    }

    public List<JSONObject> drain(int limit, long now) throws Exception {
        return store.drain(limit, now);
    }

    public boolean beginForeground(
        String deliveryId,
        String deliveryToken,
        String scheduleId,
        String executionId,
        String checkpoint,
        long now
    ) {
        return store.beginForeground(deliveryId, deliveryToken, scheduleId, executionId, checkpoint, now);
    }

    public ScheduleSnapshot acknowledge(
        String deliveryId,
        String deliveryToken,
        String scheduleId,
        String executionId,
        String status,
        String error,
        String checkpoint,
        String result,
        long now
    ) throws Exception {
        ScheduleSnapshot next = store.acknowledge(
            deliveryId,
            deliveryToken,
            scheduleId,
            executionId,
            status,
            error,
            checkpoint,
            result,
            now
        );
        if (next != null) enqueue(next, ExistingWorkPolicy.REPLACE, now);
        else if (SchedulerState.RETRYABLE_FAILED.equals(status)) {
            ScheduleEntity schedule = store.findSchedule(scheduleId);
            ScheduleExecutionEntity execution = store.findExecution(executionId);
            if (schedule != null && execution != null) enqueue(new ScheduleSnapshot(schedule, execution), ExistingWorkPolicy.REPLACE, now);
        } else if (SchedulerState.CANCELLED.equals(status) || SchedulerState.PERMANENT_FAILED.equals(status)) {
            cancelWork(scheduleId);
        }
        return next;
    }

    public void enqueue(ScheduleSnapshot snapshot, ExistingWorkPolicy policy, long now) {
        long delay = Math.max(0L, snapshot.schedule.nextRunAt - now);
        Constraints constraints = new Constraints.Builder()
            .setRequiredNetworkType(snapshot.schedule.requiresNetwork ? NetworkType.CONNECTED : NetworkType.NOT_REQUIRED)
            .build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(YachiyoScheduleWorker.class)
            .setInitialDelay(delay, TimeUnit.MILLISECONDS)
            .setConstraints(constraints)
            // Only identifiers are passed to WorkManager. Payloads and credentials remain in Room/Keystore.
            .setInputData(
                new androidx.work.Data.Builder()
                    .putString(YachiyoScheduleWorker.KEY_SCHEDULE_ID, snapshot.schedule.id)
                    .putString(YachiyoScheduleWorker.KEY_EXECUTION_ID, snapshot.execution.id)
                    .build()
            )
            .addTag(YachiyoScheduleWorker.TAG)
            .addTag(YachiyoScheduleWorker.TAG + ":" + snapshot.schedule.id)
            .build();
        WorkManager.getInstance(context).enqueueUniqueWork(uniqueWorkName(snapshot.schedule.id), policy, request);
    }

    public void cancelWork(String scheduleId) {
        if (scheduleId == null || scheduleId.trim().isEmpty()) return;
        WorkManager.getInstance(context).cancelUniqueWork(uniqueWorkName(scheduleId));
    }

    public static String uniqueWorkName(String scheduleId) {
        return UNIQUE_WORK_PREFIX + scheduleId;
    }
}

