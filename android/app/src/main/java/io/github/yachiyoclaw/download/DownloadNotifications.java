package io.github.yachiyoclaw.download;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import androidx.core.app.NotificationCompat;
import androidx.work.ForegroundInfo;
import android.content.pm.ServiceInfo;
import io.github.yachiyoclaw.MainActivity;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.Locale;

/** One independent low-priority notification per active transfer. */
public final class DownloadNotifications {
    private static final String CHANNEL = "yachiyo_downloads";
    private static final String ID_PREFS = "yachiyo-download-notification-ids";
    private static final int FIRST_ID = 12_000;
    private static final int ID_CAPACITY = 1_000_000;
    private DownloadNotifications() {}

    public static void show(Context context, String id, String title, long bytes, long total) {
        show(context, id, title, bytes, total, 0);
    }

    public static void show(Context context, String id, String title, long bytes, long total, long bytesPerSecond) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL, "下载任务", NotificationManager.IMPORTANCE_LOW));
        int percent = total > 0 ? (int) Math.min(100, bytes * 100 / total) : 0;
        Intent launch = new Intent(context, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra("openDownloads", true);
        int notificationId = notificationId(context, id);
        PendingIntent pending = PendingIntent.getActivity(context, notificationId, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        manager.notify(notificationId, new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(title)
            .setContentText(progressText(bytes, total, bytesPerSecond))
            .setProgress(100, percent, total <= 0)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setContentIntent(pending)
            .build());
    }

    public static ForegroundInfo foreground(Context context, String id, String title, long bytes, long total) {
        return foreground(context, id, title, bytes, total, 0);
    }

    public static ForegroundInfo foreground(Context context, String id, String title, long bytes, long total, long bytesPerSecond) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL, "下载任务", NotificationManager.IMPORTANCE_LOW));
        int percent = total > 0 ? (int) Math.min(100, bytes * 100 / total) : 0;
        Intent launch = new Intent(context, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra("openDownloads", true);
        int notificationId = notificationId(context, id);
        PendingIntent pending = PendingIntent.getActivity(context, notificationId, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        android.app.Notification notification = new NotificationCompat.Builder(context, CHANNEL).setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(title).setContentText(progressText(bytes, total, bytesPerSecond)).setProgress(100, percent, total <= 0).setOnlyAlertOnce(true).setOngoing(true).setContentIntent(pending).build();
        return new ForegroundInfo(notificationId, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
    }

    public static void complete(Context context, String id, String title) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        int notificationId = notificationId(context, id);
        PendingIntent pending = downloadsIntent(context, notificationId);
        manager.notify(notificationId, new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download_done).setContentTitle(title).setContentText("下载完成")
            .setContentIntent(pending).setAutoCancel(true).build());
    }

    public static void failed(Context context, String id, String title) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL, "下载任务", NotificationManager.IMPORTANCE_LOW));
        int notificationId = notificationId(context, id);
        manager.notify(notificationId, new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_notify_error)
            .setContentTitle(title)
            .setContentText("下载失败，点击查看详情")
            .setContentIntent(downloadsIntent(context, notificationId))
            .setAutoCancel(true)
            .build());
    }

    public static void cancel(Context context, String id) {
        Integer notificationId = existingNotificationId(context, id);
        if (notificationId != null) context.getSystemService(NotificationManager.class).cancel(notificationId);
    }

    /** Cancels the last notification before making its numeric id available to a future task. */
    static synchronized void cancelAndRelease(Context context, String id) {
        SharedPreferences prefs = idPreferences(context);
        if (prefs.contains(id)) {
            int notificationId = prefs.getInt(id, 0);
            if (notificationId > 0) context.getSystemService(NotificationManager.class).cancel(notificationId);
            prefs.edit().remove(id).commit();
        }
    }

    private static PendingIntent downloadsIntent(Context context, int requestCode) {
        Intent launch = new Intent(context, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra("openDownloads", true);
        return PendingIntent.getActivity(context, requestCode, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static synchronized Integer existingNotificationId(Context context, String id) {
        SharedPreferences prefs = idPreferences(context);
        return prefs.contains(id) ? prefs.getInt(id, 0) : null;
    }

    private static synchronized int notificationId(Context context, String id) {
        SharedPreferences prefs = idPreferences(context);
        if (prefs.contains(id)) return prefs.getInt(id, FIRST_ID);
        Map<String, Integer> assigned = new HashMap<>();
        for (Map.Entry<String, ?> entry : prefs.getAll().entrySet()) {
            if (entry.getValue() instanceof Integer) assigned.put(entry.getKey(), (Integer) entry.getValue());
        }
        int allocated = allocateId(id, assigned);
        if (!prefs.edit().putInt(id, allocated).commit()) throw new IllegalStateException("download_notification_id_persist_failed");
        return allocated;
    }

    /** Pure collision-resolving allocator used by the persistent mapping and JVM tests. */
    static int allocateId(String id, Map<String, Integer> assigned) {
        Integer existing = assigned.get(id);
        if (existing != null) return existing;
        Set<Integer> occupied = new HashSet<>(assigned.values());
        int offset = Math.floorMod(id.hashCode(), ID_CAPACITY);
        for (int probe = 0; probe < ID_CAPACITY; probe++) {
            int candidate = FIRST_ID + (offset + probe) % ID_CAPACITY;
            if (!occupied.contains(candidate)) return candidate;
        }
        throw new IllegalStateException("download_notification_id_exhausted");
    }

    static String progressText(long bytes, long total, long bytesPerSecond) {
        if (total <= 0) return "正在连接";
        int percent = (int) Math.min(100, Math.max(0, bytes) * 100 / total);
        StringBuilder text = new StringBuilder().append(percent).append('%');
        if (bytesPerSecond > 0) text.append(" · ").append(formatBytes(bytesPerSecond)).append("/s");
        text.append(" · ").append(formatBytes(Math.max(0, bytes))).append(" / ").append(formatBytes(total));
        return text.toString();
    }

    private static String formatBytes(long value) {
        if (value < 1024) return value + " B";
        String[] units = { "KB", "MB", "GB", "TB" };
        double amount = value;
        int unit = -1;
        do {
            amount /= 1024.0;
            unit++;
        } while (amount >= 1024.0 && unit < units.length - 1);
        return String.format(Locale.ROOT, amount >= 100 ? "%.0f %s" : amount >= 10 ? "%.1f %s" : "%.2f %s", amount, units[unit]);
    }

    private static SharedPreferences idPreferences(Context context) {
        return context.getApplicationContext().getSharedPreferences(ID_PREFS, Context.MODE_PRIVATE);
    }
}
