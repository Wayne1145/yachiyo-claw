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
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

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
            ensureFreeSpace(total - job.optLong("bytesDownloaded", 0));
            if (!store.updateIfWorkerActive(jobId, "downloading", completedBytes(job), null, null)) return Result.success();
            setForegroundAsync(YachiyoModelNotification.foreground(getApplicationContext(), jobId, progress(completedBytes(job), total)));

            File modelDirectory = store.modelDirectory(job);
            JSONArray artifacts = job.getJSONArray("artifacts");
            String runtimePath = null;
            for (int index = 0; index < artifacts.length(); index++) {
                if (isStopped()) return paused(jobId, job);
                JSONObject artifact = artifacts.getJSONObject(index);
                File output = ModelDownloadPolicy.resolveArtifact(modelDirectory, artifact.getString("path"));
                downloadArtifact(jobId, job, artifact, output, total);
                artifact.put("completedBytes", artifact.getLong("sizeBytes"));
                if ("litertlm".equals(artifact.optString("format")) || output.getName().toLowerCase(Locale.ROOT).endsWith(".litertlm")) {
                    runtimePath = output.getAbsolutePath();
                }
                if ("tflite".equals(artifact.optString("format")) || output.getName().toLowerCase(Locale.ROOT).endsWith(".tflite")) {
                    runtimePath = output.getAbsolutePath();
                }
                if (!store.saveIfWorkerActive(job)) return Result.success();
            }
            if (runtimePath == null) throw new IllegalArgumentException("runnable_model_artifact_missing");
            if (!store.updateIfWorkerActive(jobId, "completed", total, null, runtimePath)) return Result.success();
            setProgressAsync(new Data.Builder().putLong("bytesDownloaded", total).putLong("bytesTotal", total).putString("status", "completed").build());
            return Result.success();
        } catch (Exception error) {
            if (isStopped() || error instanceof InterruptedException) {
                try {
                    JSONObject job = store.read(jobId);
                    if (job != null) {
                        store.updateIfWorkerActive(jobId, "paused", completedBytes(job), null, null);
                    }
                } catch (Exception ignored) {}
                return Result.success();
            }
            try { store.updateIfWorkerActive(jobId, "failed", currentDownloaded(jobId), safeError(error), null); } catch (Exception ignored) {}
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
        output.getParentFile().mkdirs();
        File temporary = new File(output.getPath() + ".part");
        long expected = artifact.getLong("sizeBytes");
        if (output.isFile() && output.length() == expected && verifySha256(output, artifact.getString("sha256"))) return;
        if (output.exists()) Files.delete(output.toPath());
        long offset = temporary.isFile() ? temporary.length() : 0;
        if (offset > expected) {
            Files.delete(temporary.toPath());
            offset = 0;
        }

        HttpURLConnection connection = open(artifact.getString("downloadUrl"), offset);
        int status = connection.getResponseCode();
        boolean append = offset > 0 && status == HttpURLConnection.HTTP_PARTIAL;
        if (status != HttpURLConnection.HTTP_OK && status != HttpURLConnection.HTTP_PARTIAL) {
            connection.disconnect();
            throw new IllegalStateException("model_download_http_" + status);
        }
        if (!append) offset = 0;
        long lastUpdate = 0;
        try (BufferedInputStream input = new BufferedInputStream(connection.getInputStream(), BUFFER_SIZE);
             FileOutputStream file = new FileOutputStream(temporary, append)) {
            byte[] buffer = new byte[BUFFER_SIZE];
            int read;
            long written = offset;
            while ((read = input.read(buffer)) >= 0) {
                if (isStopped()) throw new InterruptedException("model_download_paused");
                if (read == 0) continue;
                written += read;
                if (written > expected) throw new IllegalStateException("model_download_size_mismatch");
                file.write(buffer, 0, read);
                artifact.put("completedBytes", written);
                long now = System.currentTimeMillis();
                if (now - lastUpdate >= 500) {
                    lastUpdate = now;
                    long downloaded = completedBytes(job);
                    job.put("bytesDownloaded", downloaded).put("status", "downloading").put("updatedAt", now);
                    if (!store.saveIfWorkerActive(job)) throw new InterruptedException("model_download_inactive");
                    int progress = progress(downloaded, total);
                    setProgressAsync(new Data.Builder().putLong("bytesDownloaded", downloaded).putLong("bytesTotal", total).putInt("progress", progress).build());
                    setForegroundAsync(YachiyoModelNotification.foreground(getApplicationContext(), jobId, progress));
                }
            }
            file.getFD().sync();
        } finally {
            connection.disconnect();
        }
        if (temporary.length() != expected) throw new IllegalStateException("model_download_size_mismatch");
        if (!verifySha256(temporary, artifact.getString("sha256"))) {
            Files.deleteIfExists(temporary.toPath());
            throw new SecurityException("model_download_hash_mismatch");
        }
        Files.move(temporary.toPath(), output.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }

    private HttpURLConnection open(String value, long offset) throws Exception {
        URL current = ModelDownloadPolicy.requireInitialUrl(value);
        for (int redirects = 0; redirects <= ModelDownloadPolicy.MAX_REDIRECTS; redirects++) {
            HttpURLConnection connection = (HttpURLConnection) current.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(20_000);
            connection.setReadTimeout(30_000);
            connection.setRequestProperty("Accept-Encoding", "identity");
            connection.setRequestProperty("User-Agent", "Yachiyo-Claw-Android");
            if (offset > 0) connection.setRequestProperty("Range", "bytes=" + offset + "-");
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

    private Result paused(String jobId, JSONObject job) throws Exception {
        store.updateIfWorkerActive(jobId, "paused", completedBytes(job), null, null);
        return Result.success();
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
