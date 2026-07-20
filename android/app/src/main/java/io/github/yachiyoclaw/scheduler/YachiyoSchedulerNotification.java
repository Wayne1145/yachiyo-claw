package io.github.yachiyoclaw.scheduler;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import io.github.yachiyoclaw.MainActivity;

/** Notification content is deliberately generic and never includes a prompt, credential or result. */
final class YachiyoSchedulerNotification {
    private static final String CHANNEL_ID = "yachiyo-scheduler-status";
    private static final int CHANNEL_IMPORTANCE = NotificationManager.IMPORTANCE_LOW;

    private YachiyoSchedulerNotification() {}

    static void post(Context context, String executionId) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Yachiyo Claw background tasks",
                    CHANNEL_IMPORTANCE
                );
                channel.setDescription("Background task status; no task content is included.");
                manager.createNotificationChannel(channel);
            }

            Intent launchIntent = new Intent(context, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pendingIntent = PendingIntent.getActivity(
                context,
                executionId.hashCode(),
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            NotificationCompat.Builder notification = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_popup_reminder)
                .setContentTitle("Yachiyo Claw")
                .setContentText("A scheduled task is ready. Open Yachiyo Claw to continue.")
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setPriority(NotificationCompat.PRIORITY_LOW);
            manager.notify(executionId.hashCode(), notification.build());
        } catch (RuntimeException ignored) {
            // Notification permission or OEM restrictions cannot invalidate the durable outbox wake.
        }
    }
}
