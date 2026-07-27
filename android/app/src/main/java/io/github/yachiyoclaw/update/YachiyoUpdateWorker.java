package io.github.yachiyoclaw.update;

import android.app.ActivityManager;
import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import io.github.yachiyoclaw.download.DownloadNotifications;
import io.github.yachiyoclaw.download.DownloadTaskStore;
import io.github.yachiyoclaw.download.DownloadTransfer;
import io.github.yachiyoclaw.download.YachiyoDownloadSettingsPlugin;
import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;

/** Persistent APK transfer. Package and digest verification happen before it becomes installable. */
public final class YachiyoUpdateWorker extends Worker {
    static final String VERSION = "version", URL_KEY = "url", SIZE = "size", DIGEST = "digest", SIDECAR = "sidecar";
    private static final String PREFS = "yachiyo-update", PREF_FILE = "verified-file", PREF_DIGEST = "verified-digest";

    public YachiyoUpdateWorker(@NonNull Context context, @NonNull WorkerParameters params) { super(context, params); }

    @NonNull @Override public Result doWork() {
        String version = getInputData().getString(VERSION);
        String taskId = "update-" + version;
        try {
            URL apkUrl = UpdateDownloadPolicy.requireInitialReleaseUrl(getInputData().getString(URL_KEY));
            long size = getInputData().getLong(SIZE, 0);
            String digest = UpdateDownloadPolicy.parseSha256(getInputData().getString(DIGEST));
            String sidecarValue = getInputData().getString(SIDECAR);
            if (digest == null) digest = sidecarDigest(UpdateDownloadPolicy.requireInitialReleaseUrl(sidecarValue));
            if (size <= 0 || size > UpdateDownloadPolicy.MAX_APK_BYTES) throw new IllegalArgumentException("update_size_invalid");
            File directory = new File(getApplicationContext().getFilesDir(), "verified-updates");
            if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("update_storage_unavailable");
            File partial = new File(directory, "update-" + version + ".apk.partial");
            final String expectedDigest = digest;
            DownloadTaskStore.update(getApplicationContext(), taskId, "update", "Yachiyo Claw " + version, "downloading", 0, size, 0, null);
            setForegroundAsync(DownloadNotifications.foreground(getApplicationContext(), taskId, "正在下载 Yachiyo Claw 更新", 0, size));
            DownloadTransfer.download(partial, size, digest, YachiyoDownloadSettingsPlugin.threads(getApplicationContext()),
                YachiyoDownloadSettingsPlugin.retryCount(getApplicationContext()),
                (start, end) -> open(apkUrl, start, end),
                (bytes, total, speed) -> {
                    DownloadTaskStore.update(getApplicationContext(), taskId, "update", "Yachiyo Claw " + version, "downloading", bytes, total, speed, null);
                    DownloadNotifications.show(getApplicationContext(), taskId, "正在下载 Yachiyo Claw 更新", bytes, total);
                    setForegroundAsync(DownloadNotifications.foreground(getApplicationContext(), taskId, "正在下载 Yachiyo Claw 更新", bytes, total));
                }, () -> isStopped() || DownloadTaskStore.shouldStop(getApplicationContext(), taskId));
            UpdatePackageVerifier.requireTrusted(getApplicationContext(), partial);
            File verified = new File(directory, "update-" + version + ".apk");
            Files.move(partial.toPath(), verified.toPath(), StandardCopyOption.REPLACE_EXISTING);
            getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(PREF_FILE, verified.getAbsolutePath()).putString(PREF_DIGEST, expectedDigest).apply();
            DownloadTaskStore.update(getApplicationContext(), taskId, "update", "Yachiyo Claw " + version, "completed", size, size, 0, null);
            DownloadNotifications.complete(getApplicationContext(), taskId, "Yachiyo Claw " + version);
            return Result.success();
        } catch (Exception error) {
            String reason = safe(error);
            long size = getInputData().getLong(SIZE, 0);
            File partial = new File(new File(getApplicationContext().getFilesDir(), "verified-updates"), "update-" + version + ".apk.partial");
            String stored = DownloadTaskStore.status(getApplicationContext(), taskId);
            if (DownloadTaskStore.shouldIgnoreStoppedWorkerResult(stored, isStopped())) return Result.success();
            String status = "cancelled".equals(stored) ? "cancelled" : ("paused".equals(stored) || isStopped() ? "paused" : "failed");
            long bytes = DownloadTransfer.resumableBytes(partial, size);
            if ("cancelled".equals(status)) {
                DownloadTransfer.discard(partial);
                bytes = 0;
            }
            DownloadTaskStore.update(getApplicationContext(), taskId, "update", "Yachiyo Claw 更新", status, bytes, size, 0, reason);
            if ("failed".equals(status)) DownloadNotifications.failed(getApplicationContext(), taskId, "Yachiyo Claw 更新");
            else DownloadNotifications.cancel(getApplicationContext(), taskId);
            return "failed".equals(status) ? Result.failure() : Result.success();
        }
    }

    private String sidecarDigest(URL url) throws Exception {
        HttpURLConnection connection = open(url, -1, -1);
        try (InputStream input = new BufferedInputStream(connection.getInputStream()); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[1024]; int read, total = 0;
            while ((read = input.read(buffer)) >= 0) { total += read; if (total > UpdateDownloadPolicy.MAX_SIDECAR_BYTES) throw new IllegalStateException("update_sidecar_too_large"); output.write(buffer, 0, read); }
            String result = UpdateDownloadPolicy.parseSha256(output.toString(StandardCharsets.UTF_8));
            if (result == null) throw new IllegalStateException("update_sidecar_invalid");
            return result;
        } finally { connection.disconnect(); }
    }

    private HttpURLConnection open(URL initial, long start, long end) throws Exception {
        URL current = initial;
        for (int redirects = 0; redirects <= UpdateDownloadPolicy.MAX_REDIRECTS; redirects++) {
            UpdateDownloadPolicy.requireAllowedRedirect(current);
            HttpURLConnection connection = (HttpURLConnection) current.openConnection(proxy());
            connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(20_000); connection.setReadTimeout(30_000);
            connection.setRequestProperty("Accept-Encoding", "identity"); connection.setRequestProperty("User-Agent", "Yachiyo-Claw-Android-Updater");
            if (start >= 0) connection.setRequestProperty("Range", "bytes=" + start + "-" + end);
            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) { String location = connection.getHeaderField("Location"); connection.disconnect(); if (location == null) throw new IllegalStateException("update_redirect_invalid"); current = new URL(current, location); continue; }
            return connection;
        }
        throw new IllegalStateException("update_redirect_limit");
    }

    private Proxy proxy() { try { String value = YachiyoDownloadSettingsPlugin.proxy(getApplicationContext()); if (value == null || value.isBlank()) return Proxy.NO_PROXY; URL url = new URL(value); return new Proxy(Proxy.Type.HTTP, new InetSocketAddress(url.getHost(), url.getPort() > 0 ? url.getPort() : 80)); } catch (Exception ignored) { return Proxy.NO_PROXY; } }
    private static String safe(Exception error) { String value = error.getMessage(); return value != null && value.matches("[A-Za-z0-9._-]{1,120}") ? value : "update_download_failed"; }
}
