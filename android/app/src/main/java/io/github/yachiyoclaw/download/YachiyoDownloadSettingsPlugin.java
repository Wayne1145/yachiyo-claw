package io.github.yachiyoclaw.download;

import android.content.SharedPreferences;
import android.content.Context;
import androidx.work.Constraints;
import androidx.work.NetworkType;
import androidx.work.WorkManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import io.github.yachiyoclaw.NativeCallValues;
import java.io.File;
import java.io.RandomAccessFile;
import java.util.Base64;
import org.json.JSONObject;

/** Shared, process-persistent transport preferences. Callers retain their own URL and hash policy. */
@CapacitorPlugin(name = "YachiyoDownloads")
public final class YachiyoDownloadSettingsPlugin extends Plugin {
    private static final String PREFS = "yachiyo-downloads";
    private static final String PROXY = "proxy";
    private static final String THREADS = "threads";
    private static final String WIFI_ONLY = "wifiOnly";
    private static final String RETRY_COUNT = "retryCount";
    private static final String NAV_PREFS = "yachiyo-nav";
    private static final String PENDING_ROUTE = "pendingRoute";
    static final int DEFAULT_THREADS = 8;
    static final int DEFAULT_RETRY = 3;
    private static final int READ_CHUNK_MAX = 1024 * 1024;

    /** Records an in-app route requested from outside the webview (e.g. a download notification tap). */
    public static void setPendingRoute(android.content.Context context, String route) {
        context.getSharedPreferences(NAV_PREFS, android.content.Context.MODE_PRIVATE).edit().putString(PENDING_ROUTE, route).apply();
    }

    public static SharedPreferences preferences(android.content.Context context) {
        return context.getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE);
    }

    public static String proxy(android.content.Context context) {
        return preferences(context).getString(PROXY, "");
    }

    /** Desired parallel connections per task, clamped to the supported 1-64 range. */
    public static int threads(android.content.Context context) {
        return Math.max(1, Math.min(64, preferences(context).getInt(THREADS, DEFAULT_THREADS)));
    }

    public static boolean wifiOnly(android.content.Context context) {
        return preferences(context).getBoolean(WIFI_ONLY, false);
    }

    public static int retryCount(android.content.Context context) {
        return Math.max(0, Math.min(16, preferences(context).getInt(RETRY_COUNT, DEFAULT_RETRY)));
    }

    /** Every persistent downloader uses this exact network/storage policy. */
    public static Constraints constraints(Context context) {
        return new Constraints.Builder()
            .setRequiredNetworkType(wifiOnly(context) ? NetworkType.UNMETERED : NetworkType.CONNECTED)
            .setRequiresStorageNotLow(true)
            .build();
    }

    @PluginMethod
    public void getSettings(PluginCall call) {
        call.resolve(settings(getContext()));
    }

    private static JSObject settings(android.content.Context context) {
        JSObject result = new JSObject();
        result.put("proxy", proxy(context));
        result.put("threads", threads(context));
        result.put("wifiOnly", wifiOnly(context));
        result.put("retryCount", retryCount(context));
        return result;
    }

    @PluginMethod
    public void list(PluginCall call) {
        call.resolve(new JSObject().put("tasks", DownloadTaskStore.list(getContext())));
    }

    /** Probes public HTTPS metadata natively so CORS and content encoding cannot alter its size. */
    @PluginMethod
    public void probe(PluginCall call) {
        String url = call.getString("url", "").trim();
        long maximumBytes = NativeCallValues.getLong(call, "maximumBytes", GenericDownloadWorker.MAX_BYTES);
        // Network I/O must not run on the Capacitor bridge thread.
        new Thread(() -> {
            try {
                GenericDownloadWorker.ProbeResult result = GenericDownloadWorker.probe(getContext(), url, maximumBytes);
                call.resolve(new JSObject().put("url", result.url()).put("size", result.size()));
            } catch (Exception error) {
                call.reject(safe(error), error);
            }
        }, "yachiyo-download-probe").start();
    }

    /** Enqueues a bounded generic download for plugins, Skills, themes, and other app-owned assets. */
    @PluginMethod
    public void enqueue(PluginCall call) {
        try {
            String id = requireId(call.getString("id"));
            String kind = call.getString("kind", "resource");
            String title = call.getString("title", "下载任务").trim();
            String url = call.getString("url", "").trim();
            String digest = call.getString("expectedSha256", "").trim().toLowerCase();
            long expectedSize = NativeCallValues.getLong(call, "expectedSize", 0L);
            if (!kind.matches("[a-z0-9._-]{1,32}")) throw new IllegalArgumentException("download_kind_invalid");
            if (title.isEmpty() || title.length() > 120) throw new IllegalArgumentException("download_title_invalid");
            if (expectedSize <= 0 || expectedSize > GenericDownloadWorker.MAX_BYTES) throw new IllegalArgumentException("download_size_invalid");
            if (!digest.isEmpty() && !digest.matches("[a-f0-9]{64}")) throw new IllegalArgumentException("download_digest_invalid");
            GenericDownloadWorker.requireHttpsSyntax(url);
            JSONObject request = new JSONObject().put("id", id).put("kind", kind).put("title", title)
                .put("url", url).put("expectedSize", expectedSize).put("expectedSha256", digest);
            JSONObject existingRequest = GenericDownloadStore.get(getContext(), id);
            if (existingRequest != null && !GenericDownloadStore.sameRequest(existingRequest, request)) {
                throw new IllegalArgumentException("download_task_id_conflict");
            }
            JSONObject existingTask = DownloadTaskStore.get(getContext(), id);
            if (existingRequest != null && existingTask != null) {
                String existingStatus = existingTask.optString("status", "");
                File existingArtifact = GenericDownloadWorker.artifact(getContext(), id);
                boolean completedArtifact = "completed".equals(existingStatus)
                    && existingArtifact.isFile() && existingArtifact.length() == expectedSize;
                if (completedArtifact || "queued".equals(existingStatus) || "downloading".equals(existingStatus) || "paused".equals(existingStatus)) {
                    DownloadTaskStore.updateGeneric(
                        getContext(), id, kind, title, existingStatus,
                        existingTask.optLong("bytesDownloaded", 0), expectedSize,
                        existingTask.optLong("bytesPerSecond", 0), existingTask.optString("error", null)
                    );
                    call.resolve(new JSObject().put("accepted", true).put("reused", true).put("id", id));
                    return;
                }
            }
            GenericDownloadStore.save(getContext(), request);
            long resumable = DownloadTransfer.resumableBytes(GenericDownloadWorker.artifact(getContext(), id), expectedSize);
            DownloadTaskStore.updateGeneric(getContext(), id, kind, title, "queued", resumable, expectedSize, 0, null);
            GenericDownloadWorker.enqueue(getContext(), id);
            call.resolve(new JSObject().put("accepted", true).put("id", id));
        } catch (Exception error) {
            call.reject(safe(error), error);
        }
    }

    @PluginMethod public void pause(PluginCall call) { control(call, "paused", false); }
    @PluginMethod public void resume(PluginCall call) { control(call, "queued", false); }
    @PluginMethod public void cancel(PluginCall call) { control(call, "cancelled", true); }

    private void control(PluginCall call, String status, boolean discard) {
        try {
            String id = requireId(call.getString("id"));
            if (GenericDownloadStore.get(getContext(), id) == null) throw new IllegalArgumentException("download_task_not_generic");
            DownloadTaskStore.transition(getContext(), id, status);
            if ("queued".equals(status)) GenericDownloadWorker.enqueue(getContext(), id);
            else WorkManager.getInstance(getContext()).cancelUniqueWork(GenericDownloadWorker.workName(id));
            if (discard) {
                DownloadTransfer.discard(GenericDownloadWorker.artifact(getContext(), id));
                GenericDownloadStore.remove(getContext(), id);
                DownloadTaskStore.releaseGenericPayload(getContext(), id);
            }
            if (!"queued".equals(status)) DownloadNotifications.cancel(getContext(), id);
            call.resolve(new JSObject().put("accepted", true).put("id", id));
        } catch (Exception error) {
            call.reject(safe(error), error);
        }
    }

    /** Reads a completed artifact in bounded Base64 chunks, avoiding a single huge Capacitor bridge value. */
    @PluginMethod
    public void readCompleted(PluginCall call) {
        try {
            String id = requireId(call.getString("id"));
            if (!"completed".equals(DownloadTaskStore.status(getContext(), id))) throw new IllegalStateException("download_not_completed");
            File file = GenericDownloadWorker.artifact(getContext(), id);
            if (!file.isFile()) throw new IllegalStateException("download_artifact_missing");
            long offset = Math.max(0L, NativeCallValues.getLong(call, "offset", 0L));
            int length = Math.max(1, Math.min(READ_CHUNK_MAX, call.getInt("length", READ_CHUNK_MAX)));
            if (offset > file.length()) throw new IllegalArgumentException("download_read_offset_invalid");
            int count = (int) Math.min(length, file.length() - offset);
            byte[] bytes = new byte[count];
            try (RandomAccessFile input = new RandomAccessFile(file, "r")) {
                input.seek(offset);
                input.readFully(bytes);
            }
            call.resolve(new JSObject().put("data", Base64.getEncoder().encodeToString(bytes)).put("offset", offset)
                .put("bytesRead", count).put("total", file.length()).put("done", offset + count >= file.length()));
        } catch (Exception error) {
            call.reject(safe(error), error);
        }
    }

    @PluginMethod
    public void removeArtifact(PluginCall call) {
        try {
            String id = requireId(call.getString("id"));
            boolean keepRecord = Boolean.TRUE.equals(call.getBoolean("keepRecord", false));
            WorkManager.getInstance(getContext()).cancelUniqueWork(GenericDownloadWorker.workName(id));
            DownloadTransfer.discard(GenericDownloadWorker.artifact(getContext(), id));
            GenericDownloadStore.remove(getContext(), id);
            DownloadTaskStore.releaseGenericPayload(getContext(), id);
            if (!keepRecord) DownloadTaskStore.remove(getContext(), id);
            if (keepRecord) DownloadNotifications.cancel(getContext(), id);
            else DownloadNotifications.cancelAndRelease(getContext(), id);
            call.resolve();
        } catch (Exception error) {
            call.reject(safe(error), error);
        }
    }

    @PluginMethod
    public void saveSettings(PluginCall call) {
        String proxy = call.getString("proxy", "").trim();
        int threads = Math.max(1, Math.min(64, call.getInt("threads", DEFAULT_THREADS)));
        int retryCount = Math.max(0, Math.min(16, call.getInt("retryCount", DEFAULT_RETRY)));
        boolean wifiOnly = Boolean.TRUE.equals(call.getBoolean("wifiOnly", false));
        if (!proxy.isEmpty() && !validProxy(proxy)) {
            call.reject("download_proxy_invalid");
            return;
        }
        boolean previousWifiOnly = wifiOnly(getContext());
        boolean saved = preferences(getContext()).edit()
            .putString(PROXY, proxy)
            .putInt(THREADS, threads)
            .putInt(RETRY_COUNT, retryCount)
            .putBoolean(WIFI_ONLY, wifiOnly)
            .commit();
        if (!saved) {
            call.reject("download_settings_save_failed");
            return;
        }
        if (previousWifiOnly != wifiOnly) {
            try {
                GenericDownloadWorker.reapplyActiveDownloadConstraints(getContext());
                io.github.yachiyoclaw.model.YachiyoModelManagerPlugin.reapplyActiveDownloadConstraints(getContext());
                io.github.yachiyoclaw.update.YachiyoUpdatePlugin.reapplyActiveDownloadConstraints(getContext());
                io.github.yachiyoclaw.sandbox.YachiyoSandboxDownloadWorker.reapplyActiveDownloadConstraints(getContext());
            } catch (RuntimeException error) {
                call.reject("download_constraints_reapply_failed", error);
                return;
            }
        }
        call.resolve(settings(getContext()));
    }

    private static boolean validProxy(String value) {
        try {
            java.net.URI uri = new java.net.URI(value);
            String scheme = uri.getScheme();
            int port = uri.getPort();
            return ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme))
                && uri.getHost() != null
                && !uri.getHost().isBlank()
                && uri.getRawUserInfo() == null
                && (uri.getRawPath() == null || uri.getRawPath().isEmpty())
                && uri.getRawQuery() == null
                && uri.getRawFragment() == null
                && port <= 65535;
        } catch (Exception ignored) {
            return false;
        }
    }

    /** Remove a terminal task row from the unified index (does not touch in-flight work). */
    @PluginMethod
    public void remove(PluginCall call) {
        try {
            String id = requireId(call.getString("id"));
            JSONObject task = DownloadTaskStore.get(getContext(), id);
            if (task == null) throw new IllegalArgumentException("download_task_not_found");
            if (!DownloadTaskStore.isTerminal(task.optString("status"))) {
                throw new IllegalStateException("download_task_not_terminal");
            }
            // This only removes unified history. Model files and their runtime registry stay intact.
            DownloadTaskStore.remove(getContext(), id);
            if (DownloadTaskStore.get(getContext(), id) != null) throw new IllegalStateException("download_task_remove_rejected");
            DownloadNotifications.cancelAndRelease(getContext(), id);
            call.resolve(new JSObject().put("tasks", DownloadTaskStore.list(getContext())));
        } catch (Exception error) {
            call.reject(safe(error), error);
        }
    }

    /** Returns and clears any pending navigation requested by a notification tap. */
    @PluginMethod
    public void consumePendingRoute(PluginCall call) {
        android.content.SharedPreferences prefs = getContext().getSharedPreferences(NAV_PREFS, android.content.Context.MODE_PRIVATE);
        String route = prefs.getString(PENDING_ROUTE, "");
        if (route != null && !route.isEmpty()) prefs.edit().remove(PENDING_ROUTE).apply();
        call.resolve(new JSObject().put("route", route == null ? "" : route));
    }

    /** Called by MainActivity when a notification intent arrives while the WebView is already active. */
    public void emitPendingRoute(String route) {
        notifyListeners("route", new JSObject().put("route", route), true);
    }

    private static String requireId(String value) {
        if (value == null || !value.matches("[A-Za-z0-9._-]{1,100}")) throw new IllegalArgumentException("download_task_id_invalid");
        return value;
    }

    private static String safe(Exception error) {
        String value = error.getMessage();
        return value != null && value.matches("[A-Za-z0-9._-]{1,120}") ? value : "download_request_failed";
    }
}
