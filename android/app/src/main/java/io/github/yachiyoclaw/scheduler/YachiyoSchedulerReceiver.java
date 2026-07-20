package io.github.yachiyoclaw.scheduler;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Reconciles persisted schedules after a normal reboot or package replacement. */
public final class YachiyoSchedulerReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? "" : intent.getAction();
        if (
            !Intent.ACTION_BOOT_COMPLETED.equals(action) &&
            !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
        ) return;

        final PendingResult pendingResult = goAsync();
        ExecutorService executor = Executors.newSingleThreadExecutor();
        executor.execute(() -> {
            try {
                YachiyoSchedulerRuntime.get(context).reconcile(System.currentTimeMillis());
            } catch (Exception ignored) {
                // WorkManager will retry its persisted work; never crash the system broadcast thread.
            } finally {
                pendingResult.finish();
                executor.shutdown();
            }
        });
    }
}


