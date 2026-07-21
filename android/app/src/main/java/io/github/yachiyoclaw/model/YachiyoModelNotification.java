package io.github.yachiyoclaw.model;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import androidx.core.app.NotificationCompat;
import androidx.work.ForegroundInfo;
import io.github.yachiyoclaw.MainActivity;

final class YachiyoModelNotification {
    private static final String CHANNEL = "yachiyo_model_download";
    private static final int BASE_ID = 4700;

    private YachiyoModelNotification() {}

    static ForegroundInfo foreground(Context context, String jobId, int progress) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL, "本地模型下载", NotificationManager.IMPORTANCE_LOW));
        Intent launch = new Intent(context, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending = PendingIntent.getActivity(context, jobId.hashCode(), launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("Yachiyo Claw 正在下载本地模型")
            .setContentText(progress + "%")
            .setProgress(100, Math.max(0, Math.min(100, progress)), false)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setContentIntent(pending)
            .build();
        return new ForegroundInfo(BASE_ID + Math.abs(jobId.hashCode() % 1000), notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
    }
}
