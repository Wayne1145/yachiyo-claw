package io.github.yachiyoclaw.model;

import android.content.Context;
import android.os.StatFs;
import androidx.annotation.NonNull;
import androidx.work.Data;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.Proxy;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import org.json.JSONArray;
import org.json.JSONObject;
import io.github.yachiyoclaw.download.YachiyoDownloadSettingsPlugin;
import io.github.yachiyoclaw.download.DownloadTransfer;
import io.github.yachiyoclaw.download.DownloadTaskStore;
import io.github.yachiyoclaw.download.DownloadNotifications;

public final class YachiyoModelDownloadWorker extends Worker {
    static final String KEY_JOB_ID = "job_id";
    private static final int BUFFER_SIZE = 256 * 1024;
    private final ModelRegistryStore store;

    public YachiyoModelDownloadWorker(@NonNull Context context, @NonNull WorkerParameters parameters) {
        super(context, parameters);
        store = new ModelRegistryStore(context);
    }

    @NonNull
    @Override
    public Result doWork() {
        String jobId = getInputData().getString(KEY_JOB_ID);
        if (jobId == null) return Result.failure();
        try {
            JSONObject job = store.read(jobId);
            if (job == null) return Result.failure();
            long total = validateJob(job);
            String title = job.optString("repository", "本地模型");
            DownloadTaskStore.update(getApplicationContext(), jobId, "model", title, "downloading", completedBytes(job), total, 0, null);
            ensureFreeSpace(total - job.optLong("bytesDownloaded", 0));
            if (!store.updateIfWorkerActive(jobId, "downloading", completedBytes(job), null, null)) return Result.success();
            setForegroundAsync(DownloadNotifications.foreground(getApplicationContext(), jobId, "正在下载本地模型", completedBytes(job), total));

            File modelDirectory = store.modelDirectory(job);
            JSONArray artifacts = job.getJSONArray("artifacts");
            String runtimePath = null;
            for (int index = 0; index < artifacts.length(); index++) {
                if (isStopped()) return paused(jobId, job);
                JSONObject artifact = artifacts.getJSONObject(index);
                File output = ModelDownloadPolicy.resolveArtifact(modelDirectory, artifact.getString("path"));
                downloadArtifact(jobId, job, artifact, output, total);
                artifact.put("completedBytes", artifact.getLong("sizeBytes"));
                runtimePath = LocalModelFormat.chooseRuntimePath(runtimePath, artifact.optString("format"), output);
                if (!store.saveIfWorkerActive(job)) return Result.success();
            }
            if (runtimePath == null) throw new IllegalArgumentException("runnable_model_artifact_missing");
            if (!store.updateIfWorkerActive(jobId, "completed", total, null, runtimePath)) return Result.success();
            DownloadTaskStore.update(getApplicationContext(), jobId, "model", job.optString("repository", "本地模型"), "completed", total, total, 0, null);
            DownloadNotifications.complete(getApplicationContext(), jobId, job.optString("repository", "本地模型"));
            setProgressAsync(new Data.Builder().putLong("bytesDownloaded", total).putLong("bytesTotal", total).putString("status", "completed").build());
            return Result.success();
        } catch (Exception error) {
            if (isStopped() || error instanceof InterruptedException) {
                try {
                    JSONObject job = store.read(jobId);
                    if (job != null) {
                        if (DownloadTaskStore.shouldIgnoreStoppedWorkerResult(job.optString("status"), isStopped())) {
                            return Result.success();
                        }
                        long bytes = completedBytes(job);
                        long total = job.optLong("bytesTotal", 0);
                        String finalStatus = "cancelled".equals(job.optString("status")) ? "cancelled" : "paused";
                        store.updateIfWorkerActive(jobId, finalStatus, bytes, null, null);
                        if ("cancelled".equals(finalStatus)) {
                            discardArtifacts(job);
                            bytes = 0;
                        }
                        DownloadTaskStore.update(getApplicationContext(), jobId, "model", job.optString("repository", "本地模型"), finalStatus, bytes, total, 0, null);
                    }
                } catch (Exception ignored) {}
                DownloadNotifications.cancel(getApplicationContext(), jobId);
                return Result.success();
            }
            try { store.updateIfWorkerActive(jobId, "failed", currentDownloaded(jobId), safeError(error), null); } catch (Exception ignored) {}
            JSONObject failed = null;
            try { failed = store.read(jobId); } catch (Exception ignored) {}
            DownloadTaskStore.update(
                getApplicationContext(),
                jobId,
                "model",
                failed == null ? "本地模型" : failed.optString("repository", "本地模型"),
                "failed",
                currentDownloaded(jobId),
                failed == null ? 0 : failed.optLong("bytesTotal", 0),
                0,
                safeError(error)
            );
            DownloadNotifications.failed(getApplicationContext(), jobId, "本地模型下载失败");
            return Result.failure(new Data.Builder().putString("error", safeError(error)).build());
        }
    }

    private long validateJob(JSONObject job) throws Exception {
        JSONArray artifacts = job.getJSONArray("artifacts");
        if (artifacts.length() == 0 || artifacts.length() > 32) throw new IllegalArgumentException("model_artifacts_invalid");
        long total = 0;
        for (int index = 0; index < artifacts.length(); index++) {
            JSONObject artifact = artifacts.getJSONObject(index);
            ModelDownloadPolicy.requireInitialUrl(artifact.getString("downloadUrl"));
            ModelDownloadPolicy.requireSha256(artifact.getString("sha256"));
            long size = ModelDownloadPolicy.requireSize(artifact.getLong("sizeBytes"));
            ModelDownloadPolicy.resolveArtifact(store.modelDirectory(job), artifact.getString("path"));
            total = Math.addExact(total, size);
            if (total > ModelDownloadPolicy.MAX_MODEL_BYTES) throw new IllegalArgumentException("model_too_large");
        }
        return total;
    }

    private void ensureFreeSpace(long remaining) {
        long reserve = Math.max(512L * 1024L * 1024L, remaining / 10L);
        long available = new StatFs(getApplicationContext().getFilesDir().getAbsolutePath()).getAvailableBytes();
        if (remaining > 0 && available < remaining + reserve) throw new IllegalStateException("model_storage_insufficient");
    }

    private void downloadArtifact(String jobId, JSONObject job, JSONObject artifact, File output, long total) throws Exception {
        long expected = artifact.getLong("sizeBytes");
        long before = completedBytes(job) - artifact.optLong("completedBytes", 0);
        DownloadTransfer.download(output, expected, artifact.getString("sha256"), YachiyoDownloadSettingsPlugin.threads(getApplicationContext()),
            YachiyoDownloadSettingsPlugin.retryCount(getApplicationContext()),
            (start, end) -> open(artifact.getString("downloadUrl"), start, end),
            (written, ignored, speed) -> {
                artifact.put("completedBytes", written);
                long downloaded = before + written;
                long now = System.currentTimeMillis();
                job.put("bytesDownloaded", downloaded).put("bytesPerSecond", speed).put("status", "downloading").put("updatedAt", now);
                DownloadTaskStore.update(getApplicationContext(), jobId, "model", job.optString("repository", "本地模型"), "downloading", downloaded, total, speed, null);
                if (!store.saveIfWorkerActive(job)) throw new InterruptedException("model_download_inactive");
                int percentage = progress(downloaded, total);
                setProgressAsync(new Data.Builder().putLong("bytesDownloaded", downloaded).putLong("bytesTotal", total).putLong("bytesPerSecond", speed).putInt("progress", percentage).build());
                DownloadNotifications.show(getApplicationContext(), jobId, "正在下载本地模型", downloaded, total, speed);
                setForegroundAsync(DownloadNotifications.foreground(getApplicationContext(), jobId, "正在下载本地模型", downloaded, total, speed));
            }, this::isStopped);
    }

    private HttpURLConnection open(String value, long start, long end) throws Exception {
        String resolved = YachiyoDownloadSettingsPlugin.mirrorHuggingFaceUrl(getApplicationContext(), value);
        URL current = ModelDownloadPolicy.requireInitialUrl(resolved);
        for (int redirects = 0; redirects <= ModelDownloadPolicy.MAX_REDIRECTS; redirects++) {
            HttpURLConnection connection = (HttpURLConnection) current.openConnection(resolveProxy());
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(20_000);
            connection.setReadTimeout(30_000);
            connection.setRequestProperty("Accept-Encoding", "identity");
            connection.setRequestProperty("User-Agent", "Yachiyo-Claw-Android");
            connection.setRequestProperty("Range", "bytes=" + start + "-" + end);
            int status = connection.getResponseCode();
            if (status < 300 || status >= 400) return connection;
            String location = connection.getHeaderField("Location");
            connection.disconnect();
            if (location == null) throw new IllegalStateException("model_redirect_missing");
            current = new URL(current, location);
            ModelDownloadPolicy.requireAllowedRedirect(current);
        }
        throw new IllegalStateException("model_redirect_limit");
    }

    private Proxy resolveProxy() {
        try {
            String value = YachiyoDownloadSettingsPlugin.proxy(getApplicationContext());
            if (value == null || value.isBlank()) return Proxy.NO_PROXY;
            URL url = new URL(value);
            int port = url.getPort() > 0 ? url.getPort() : ("https".equalsIgnoreCase(url.getProtocol()) ? 443 : 80);
            return new Proxy(Proxy.Type.HTTP, new InetSocketAddress(url.getHost(), port));
        } catch (Exception ignored) { return Proxy.NO_PROXY; }
    }

    private Result paused(String jobId, JSONObject job) throws Exception {
        long bytes = completedBytes(job);
        JSONObject persisted = store.read(jobId);
        String finalStatus = persisted != null && "cancelled".equals(persisted.optString("status")) ? "cancelled" : "paused";
        store.updateIfWorkerActive(jobId, finalStatus, bytes, null, null);
        if ("cancelled".equals(finalStatus)) {
            discardArtifacts(job);
            bytes = 0;
        }
        DownloadTaskStore.update(getApplicationContext(), jobId, "model", job.optString("repository", "本地模型"), finalStatus, bytes, job.optLong("bytesTotal", 0), 0, null);
        DownloadNotifications.cancel(getApplicationContext(), jobId);
        return Result.success();
    }

    private void discardArtifacts(JSONObject job) throws Exception {
        File directory = store.modelDirectory(job);
        JSONArray artifacts = job.optJSONArray("artifacts");
        if (artifacts == null) return;
        for (int index = 0; index < artifacts.length(); index++) {
            JSONObject artifact = artifacts.optJSONObject(index);
            if (artifact == null) continue;
            DownloadTransfer.discard(ModelDownloadPolicy.resolveArtifact(directory, artifact.optString("path")));
            artifact.put("completedBytes", 0);
        }
        job.put("bytesDownloaded", 0).put("status", "cancelled").put("updatedAt", System.currentTimeMillis());
        store.save(job);
    }

    private long currentDownloaded(String jobId) {
        try { JSONObject job = store.read(jobId); return job == null ? 0 : completedBytes(job); }
        catch (Exception ignored) { return 0; }
    }

    private static long completedBytes(JSONObject job) {
        JSONArray artifacts = job.optJSONArray("artifacts");
        long total = 0;
        if (artifacts != null) for (int index = 0; index < artifacts.length(); index++) total += artifacts.optJSONObject(index).optLong("completedBytes", 0);
        return total;
    }

    private static int progress(long downloaded, long total) {
        return total <= 0 ? 0 : (int) Math.min(100, downloaded * 100L / total);
    }

    private static boolean verifySha256(File file, String expected) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (DigestInputStream input = new DigestInputStream(new FileInputStream(file), digest)) {
            byte[] buffer = new byte[BUFFER_SIZE];
            while (input.read(buffer) >= 0) {}
        }
        StringBuilder actual = new StringBuilder();
        for (byte item : digest.digest()) actual.append(String.format("%02x", item));
        return actual.toString().equalsIgnoreCase(expected);
    }

    private static String safeError(Exception error) {
        String message = error.getMessage();
        return message != null && message.matches("[A-Za-z0-9._-]{1,120}") ? message : "model_download_failed";
    }
}
