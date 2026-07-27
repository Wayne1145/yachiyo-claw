package io.github.yachiyoclaw.sandbox;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkInfo;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import io.github.yachiyoclaw.download.DownloadNotifications;
import io.github.yachiyoclaw.download.DownloadTaskStore;
import io.github.yachiyoclaw.download.DownloadTransfer;
import io.github.yachiyoclaw.download.YachiyoDownloadSettingsPlugin;
import java.io.File;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.URI;
import java.net.URL;
import java.util.UUID;

/** Persistent, resumable Alpine rootfs transfer owned by WorkManager rather than the WebView. */
public final class YachiyoSandboxDownloadWorker extends Worker {
    private static final String ARCH = "arch";

    public YachiyoSandboxDownloadWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    static String taskId(SandboxDistribution.Spec spec) { return "sandbox-rootfs-" + spec.alpineArch(); }
    static String workName(SandboxDistribution.Spec spec) { return "yachiyo-" + taskId(spec); }

    static File archiveFile(Context context, SandboxDistribution.Spec spec) {
        File directory = new File(context.getFilesDir(), "download-cache/sandbox");
        return new File(directory, SandboxDistribution.VERSION + "-" + spec.alpineArch() + ".tar.gz");
    }

    static UUID enqueue(Context context, SandboxDistribution.Spec spec) {
        DownloadTaskStore.transition(context, taskId(spec), "queued");
        Data input = new Data.Builder().putString(ARCH, spec.alpineArch()).build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(YachiyoSandboxDownloadWorker.class)
            .setInputData(input)
            .setConstraints(YachiyoDownloadSettingsPlugin.constraints(context))
            .addTag("yachiyo-sandbox-download")
            .build();
        WorkManager.getInstance(context).enqueueUniqueWork(workName(spec), ExistingWorkPolicy.REPLACE, request);
        return request.getId();
    }

    /** Replaces an active rootfs worker so the latest global network constraint is applied. */
    public static void reapplyActiveDownloadConstraints(Context context) {
        SandboxDistribution.Spec spec = SandboxDistribution.current(context.getApplicationInfo().nativeLibraryDir);
        if (spec == null) return;
        String status = DownloadTaskStore.status(context, taskId(spec));
        if ("queued".equals(status) || "downloading".equals(status)) enqueue(context, spec);
    }

    static void pause(Context context, SandboxDistribution.Spec spec) {
        DownloadTaskStore.transition(context, taskId(spec), "paused");
        WorkManager.getInstance(context).cancelUniqueWork(workName(spec));
        DownloadNotifications.cancel(context, taskId(spec));
    }

    static void cancel(Context context, SandboxDistribution.Spec spec) {
        DownloadTaskStore.transition(context, taskId(spec), "cancelled");
        WorkManager.getInstance(context).cancelUniqueWork(workName(spec));
        DownloadTransfer.discard(archiveFile(context, spec));
        DownloadNotifications.cancel(context, taskId(spec));
    }

    static File await(Context context, SandboxDistribution.Spec spec, AlpineSandboxInstaller.ProgressListener listener) throws Exception {
        File archive = archiveFile(context, spec);
        if (archive.isFile() && archive.length() == spec.size() && DownloadTransfer.verify(archive, spec.sha256())) {
            DownloadTaskStore.update(context, taskId(spec), "sandbox", "Linux 沙箱基础环境", "completed", spec.size(), spec.size(), 0, null);
            return archive;
        }
        UUID requestId = enqueue(context, spec);
        WorkManager manager = WorkManager.getInstance(context);
        while (true) {
            org.json.JSONObject task = DownloadTaskStore.get(context, taskId(spec));
            if (task != null) {
                long bytes = task.optLong("bytesDownloaded", 0);
                listener.onProgress("downloading", (int) Math.min(100, bytes * 100 / Math.max(1, spec.size())), bytes, spec.size());
                String status = task.optString("status");
                if ("paused".equals(status)) throw new InterruptedException("sandbox_download_paused");
                if ("cancelled".equals(status)) throw new InterruptedException("sandbox_download_cancelled");
                if ("failed".equals(status)) throw new IllegalStateException(task.optString("error", "sandbox_download_failed"));
            }
            WorkInfo info = manager.getWorkInfoById(requestId).get();
            if (info != null && info.getState().isFinished()) {
                if (info.getState() == WorkInfo.State.SUCCEEDED && archive.isFile() && DownloadTransfer.verify(archive, spec.sha256())) return archive;
                String status = DownloadTaskStore.status(context, taskId(spec));
                if ("paused".equals(status) || "cancelled".equals(status)) throw new InterruptedException("sandbox_download_" + status);
                throw new IllegalStateException("sandbox_download_failed");
            }
            Thread.sleep(250);
        }
    }

    @NonNull @Override public Result doWork() {
        SandboxDistribution.Spec spec = SandboxDistribution.current(getApplicationContext().getApplicationInfo().nativeLibraryDir);
        String arch = getInputData().getString(ARCH);
        if (spec == null || arch == null || !arch.equals(spec.alpineArch())) return Result.failure();
        String taskId = taskId(spec);
        File archive = archiveFile(getApplicationContext(), spec);
        try {
            File parent = archive.getParentFile();
            if (parent != null && !parent.isDirectory() && !parent.mkdirs()) throw new IllegalStateException("sandbox_download_storage_unavailable");
            if (DownloadTaskStore.shouldStop(getApplicationContext(), taskId)) return Result.success();
            long existing = DownloadTransfer.resumableBytes(archive, spec.size());
            DownloadTaskStore.update(getApplicationContext(), taskId, "sandbox", "Linux 沙箱基础环境", "downloading", existing, spec.size(), 0, null);
            setForegroundAsync(DownloadNotifications.foreground(getApplicationContext(), taskId, "正在下载 Linux 沙箱基础环境", existing, spec.size()));
            DownloadTransfer.download(
                archive,
                spec.size(),
                spec.sha256(),
                YachiyoDownloadSettingsPlugin.threads(getApplicationContext()),
                YachiyoDownloadSettingsPlugin.retryCount(getApplicationContext()),
                (start, end) -> open(spec, start, end),
                (bytes, total, speed) -> {
                    DownloadTaskStore.update(getApplicationContext(), taskId, "sandbox", "Linux 沙箱基础环境", "downloading", bytes, total, speed, null);
                    DownloadNotifications.show(getApplicationContext(), taskId, "正在下载 Linux 沙箱基础环境", bytes, total);
                    setForegroundAsync(DownloadNotifications.foreground(getApplicationContext(), taskId, "正在下载 Linux 沙箱基础环境", bytes, total));
                },
                () -> isStopped() || DownloadTaskStore.shouldStop(getApplicationContext(), taskId)
            );
            DownloadTaskStore.update(getApplicationContext(), taskId, "sandbox", "Linux 沙箱基础环境", "completed", spec.size(), spec.size(), 0, null);
            DownloadNotifications.complete(getApplicationContext(), taskId, "Linux 沙箱基础环境");
            return Result.success();
        } catch (Exception error) {
            String stored = DownloadTaskStore.status(getApplicationContext(), taskId);
            if (DownloadTaskStore.shouldIgnoreStoppedWorkerResult(stored, isStopped())) return Result.success();
            String status = "paused".equals(stored) || "cancelled".equals(stored) ? stored : (isStopped() ? "paused" : "failed");
            long bytes = DownloadTransfer.resumableBytes(archive, spec.size());
            String reason = safe(error);
            DownloadTaskStore.update(getApplicationContext(), taskId, "sandbox", "Linux 沙箱基础环境", status, bytes, spec.size(), 0, reason);
            if ("failed".equals(status)) DownloadNotifications.failed(getApplicationContext(), taskId, "Linux 沙箱基础环境下载失败");
            return "failed".equals(status) ? Result.failure() : Result.success();
        }
    }

    private HttpURLConnection open(SandboxDistribution.Spec spec, long start, long end) throws Exception {
        URL current = new URI(spec.url()).toURL();
        for (int redirects = 0; redirects <= 4; redirects++) {
            requireAllowed(current);
            HttpURLConnection connection = (HttpURLConnection) current.openConnection(proxy());
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(20_000);
            connection.setReadTimeout(30_000);
            connection.setRequestProperty("Accept-Encoding", "identity");
            connection.setRequestProperty("User-Agent", "Yachiyo-Claw-Android-Sandbox");
            connection.setRequestProperty("Range", "bytes=" + start + "-" + end);
            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null) throw new IllegalStateException("sandbox_redirect_invalid");
                current = new URL(current, location);
                continue;
            }
            return connection;
        }
        throw new IllegalStateException("sandbox_redirect_limit");
    }

    private static void requireAllowed(URL url) {
        if (!"https".equalsIgnoreCase(url.getProtocol())
            || !"dl-cdn.alpinelinux.org".equalsIgnoreCase(url.getHost())
            || url.getUserInfo() != null) throw new IllegalArgumentException("sandbox_download_url_rejected");
    }

    private Proxy proxy() {
        try {
            String value = YachiyoDownloadSettingsPlugin.proxy(getApplicationContext());
            if (value == null || value.isBlank()) return Proxy.NO_PROXY;
            URL url = new URL(value);
            int port = url.getPort() > 0 ? url.getPort() : ("https".equalsIgnoreCase(url.getProtocol()) ? 443 : 80);
            return new Proxy(Proxy.Type.HTTP, new InetSocketAddress(url.getHost(), port));
        } catch (Exception ignored) {
            return Proxy.NO_PROXY;
        }
    }

    private static String safe(Exception error) {
        String value = error.getMessage();
        return value != null && value.matches("[A-Za-z0-9._-]{1,120}") ? value : "sandbox_download_failed";
    }
}
