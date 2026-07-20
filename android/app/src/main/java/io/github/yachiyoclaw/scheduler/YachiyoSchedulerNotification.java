package io.github.yachiyoclaw.scheduler;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Notification;
import android.content.pm.ServiceInfo;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.work.ForegroundInfo;
import io.github.yachiyoclaw.MainActivity;

/** Notification content is deliberately generic and never includes a prompt, credential or result. */
final class YachiyoSchedulerNotification {
    private static final String CHANNEL_ID = "yachiyo-scheduler-status";
    private static final int CHANNEL_IMPORTANCE = NotificationManager.IMPORTANCE_LOW;

    private YachiyoSchedulerNotification() {}

    static ForegroundInfo foregroundInfo(Context context, String executionId) {
        Notification notification = build(context, executionId, false);
        int notificationId = notificationId(executionId);
        if (Build.VERSION.SDK_INT >= 34) {
            return new ForegroundInfo(
                notificationId,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE
            );
        }
        return new ForegroundInfo(notificationId, notification);
    }

    static void post(Context context, String executionId) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        try {
            manager.notify(notificationId(executionId), build(context, executionId, true));
        } catch (RuntimeException ignored) {
            // Notification permission or OEM restrictions cannot invalidate the durable outbox wake.
        }
    }

    private static Notification build(Context context, String executionId, boolean ready) {
        ensureChannel(context);
        Intent launchIntent = new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            context,
            notificationId(executionId),
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        return new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setContentTitle("Yachiyo Claw")
            .setContentText(
                ready
                    ? "A scheduled task is ready. Open Yachiyo Claw to continue."
                    : "Preparing a scheduled task."
            )
            .setContentIntent(pendingIntent)
            .setAutoCancel(ready)
            .setOngoing(!ready)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    private static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Yachiyo Claw background tasks",
            CHANNEL_IMPORTANCE
        );
        channel.setDescription("Background task status; no task content is included.");
        manager.createNotificationChannel(channel);
    }

    private static int notificationId(String executionId) {
        int result = executionId.hashCode();
        return result == 0 ? 1 : result;
    }
}
