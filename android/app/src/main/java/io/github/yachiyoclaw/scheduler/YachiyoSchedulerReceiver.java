package io.github.yachiyoclaw.scheduler;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.UserManager;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Reconciles persisted schedules after system events without launching an Activity. */
public final class YachiyoSchedulerReceiver extends BroadcastReceiver {
    private static final String RECOVERY_PREFS = "yachiyo-scheduler-recovery";
    private static final String PENDING_UNLOCK = "pending-unlock";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? "" : intent.getAction();
        if (!SchedulerRecoveryPolicy.supports(action)) return;

        boolean userUnlocked = isUserUnlocked(context);
        if (!SchedulerRecoveryPolicy.shouldReconcile(action, userUnlocked)) {
            deviceProtectedPreferences(context).edit().putBoolean(PENDING_UNLOCK, true).apply();
            return;
        }

        final PendingResult pendingResult = goAsync();
        ExecutorService executor = Executors.newSingleThreadExecutor();
        executor.execute(() -> {
            try {
                boolean replace = SchedulerRecoveryPolicy.replacesExistingWork(action) ||
                    deviceProtectedPreferences(context).getBoolean(PENDING_UNLOCK, false);
                YachiyoSchedulerRuntime.get(context).reconcileAfterSystemEvent(System.currentTimeMillis(), replace);
                deviceProtectedPreferences(context).edit().remove(PENDING_UNLOCK).apply();
            } catch (Exception ignored) {
                // WorkManager will retry its persisted work; never crash the system broadcast thread.
            } finally {
                pendingResult.finish();
                executor.shutdown();
            }
        });
    }

    private static boolean isUserUnlocked(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return true;
        UserManager manager = (UserManager) context.getSystemService(Context.USER_SERVICE);
        return manager == null || manager.isUserUnlocked();
    }

    private static SharedPreferences deviceProtectedPreferences(Context context) {
        Context storageContext = Build.VERSION.SDK_INT >= Build.VERSION_CODES.N
            ? context.createDeviceProtectedStorageContext()
            : context;
        return storageContext.getSharedPreferences(RECOVERY_PREFS, Context.MODE_PRIVATE);
    }
}

