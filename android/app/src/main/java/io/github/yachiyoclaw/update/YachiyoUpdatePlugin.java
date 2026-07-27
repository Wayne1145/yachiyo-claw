package io.github.yachiyoclaw.update;

import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import io.github.yachiyoclaw.download.DownloadTaskStore;
import io.github.yachiyoclaw.NativeCallValues;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;

/**
 * Front-end control surface for the persistent, WorkManager-backed APK updater.
 * The actual transfer, digest, package-name and signing verification live in {@link YachiyoUpdateWorker};
 * this plugin only enqueues work, mirrors state to the UI, and launches the verified install intent.
 */
@CapacitorPlugin(name = "YachiyoUpdate")
public final class YachiyoUpdatePlugin extends Plugin {
    private static final String PREFS = "yachiyo-update";
    private static final String PREF_FILE = "verified-file";
    private static final String PREF_DIGEST = "verified-digest";
    private static final String PREF_PENDING_VERSION = "pending-version";
    private static final String PREF_PENDING_URL = "pending-url";
    private static final String PREF_PENDING_SIZE = "pending-size";
    private static final String PREF_PENDING_DIGEST = "pending-digest";
    private static final String PREF_PENDING_SIDECAR = "pending-sidecar";
    private static final String APK_MIME = "application/vnd.android.package-archive";
    private static final String UPDATE_DIR = "verified-updates";
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    static String workName(String version) { return "yachiyo-update-" + version; }

    @PluginMethod
    public void downloadUpdate(PluginCall call) {
        final String version;
        final URL apkUrl;
        final URL sidecarUrl;
        final String providedDigest;
        final long expectedSize = Math.max(0L, NativeCallValues.getLong(call, "size", 0L));
        try {
            version = UpdateDownloadPolicy.safeVersion(call.getString("version"));
            apkUrl = UpdateDownloadPolicy.requireInitialReleaseUrl(call.getString("url"));
            providedDigest = UpdateDownloadPolicy.parseSha256(call.getString("sha256"));
            String sidecar = call.getString("sha256SidecarUrl");
            sidecarUrl = sidecar == null || sidecar.trim().isEmpty() ? null : UpdateDownloadPolicy.requireInitialReleaseUrl(sidecar);
            if (providedDigest == null && sidecarUrl == null) throw new IllegalArgumentException("update_digest_required");
            if (expectedSize <= 0 || expectedSize > UpdateDownloadPolicy.MAX_APK_BYTES) throw new IllegalArgumentException("update_size_invalid");
        } catch (Exception error) {
            call.reject(fixedReason(error, "invalid_update_metadata"));
            return;
        }

        try {
            File ready = loadAndVerifyPersistedFile();
            if (ready.getName().contains("update-" + version + ".apk")) {
                JSObject event = new JSObject().put("version", version);
                notifyListeners("downloaded", event, true);
                call.resolve(event);
                return;
            }
        } catch (Exception ignored) {}

        clearVerifiedUpdateIfDifferent(version);
        persistPendingUpdate(version, apkUrl, expectedSize, providedDigest, sidecarUrl);
        enqueuePersistedUpdate(version);
        // The durable task owns the transfer. Resolving now avoids tying a long download to one
        // WebView bridge call; getDownloadStatus is the cross-process source of truth.
        call.resolve(new JSObject().put("accepted", true).put("version", version));
    }

    /** Lets the front-end restore the install prompt after a restart when a verified APK is already on disk. */
    @PluginMethod
    public void getDownloadStatus(PluginCall call) {
        JSObject result = new JSObject();
        try {
            File apk = loadAndVerifyPersistedFile();
            String name = apk.getName();
            String version = name.startsWith("update-") && name.endsWith(".apk") ? name.substring(7, name.length() - 4) : "";
            result.put("ready", true).put("version", version).put("status", "completed").put("progress", 100);
        } catch (Exception ignored) {
            android.content.SharedPreferences prefs = getContext().getSharedPreferences(PREFS, 0);
            String version = prefs.getString(PREF_PENDING_VERSION, "");
            result.put("ready", false).put("version", version == null ? "" : version);
            org.json.JSONObject task = version == null || version.isEmpty()
                ? null
                : DownloadTaskStore.get(getContext(), "update-" + version);
            if (task == null) {
                result.put("status", "idle").put("progress", 0);
            } else {
                long bytes = task.optLong("bytesDownloaded", 0);
                long total = task.optLong("bytesTotal", 0);
                int progress = total > 0 ? (int) Math.min(100, bytes * 100 / total) : 0;
                result.put("status", task.optString("status", "idle"))
                    .put("progress", progress)
                    .put("bytesDownloaded", bytes)
                    .put("bytesTotal", total)
                    .put("bytesPerSecond", task.optLong("bytesPerSecond", 0));
                if (task.has("error")) result.put("error", task.optString("error"));
            }
        }
        call.resolve(result);
    }

    @PluginMethod
    public void pauseDownload(PluginCall call) { stopWork(call, "paused", false); }

    @PluginMethod
    public void resumeDownload(PluginCall call) {
        try {
            String version = UpdateDownloadPolicy.safeVersion(call.getString("version"));
            requirePendingVersion(version);
            DownloadTaskStore.transition(getContext(), "update-" + version, "queued");
            enqueuePersistedUpdate(version);
            call.resolve(new JSObject().put("accepted", true).put("version", version));
        } catch (Exception error) {
            call.reject(fixedReason(error, "update_resume_failed"));
        }
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) { stopWork(call, "cancelled", true); }

    private void stopWork(PluginCall call, String status, boolean deletePartial) {
        try {
            String version = UpdateDownloadPolicy.safeVersion(call.getString("version"));
            String taskId = "update-" + version;
            org.json.JSONObject task = DownloadTaskStore.get(getContext(), taskId);
            long bytes = task == null ? 0 : task.optLong("bytesDownloaded", 0);
            long total = task == null ? 0 : task.optLong("bytesTotal", 0);
            DownloadTaskStore.update(getContext(), taskId, "update", "Yachiyo Claw " + version, status, bytes, total, 0, null);
            WorkManager.getInstance(getContext()).cancelUniqueWork(workName(version));
            if (deletePartial) deletePartial(version);
            call.resolve(new JSObject().put("accepted", true));
        } catch (Exception error) {
            call.reject(fixedReason(error, "update_control_failed"));
        }
    }

    private void deletePartial(String version) {
        File directory = new File(getContext().getFilesDir(), UPDATE_DIR);
        File partial = new File(directory, "update-" + version + ".apk.partial");
        io.github.yachiyoclaw.download.DownloadTransfer.discard(partial);
    }

    private void persistPendingUpdate(String version, URL apkUrl, long size, String digest, URL sidecarUrl) {
        getContext().getSharedPreferences(PREFS, 0).edit()
            .putString(PREF_PENDING_VERSION, version)
            .putString(PREF_PENDING_URL, apkUrl.toString())
            .putLong(PREF_PENDING_SIZE, size)
            .putString(PREF_PENDING_DIGEST, digest)
            .putString(PREF_PENDING_SIDECAR, sidecarUrl == null ? "" : sidecarUrl.toString())
            .apply();
    }

    private void requirePendingVersion(String version) {
        requirePendingVersion(getContext(), version);
    }

    private static void requirePendingVersion(android.content.Context context, String version) {
        String pending = context.getSharedPreferences(PREFS, 0).getString(PREF_PENDING_VERSION, "");
        if (!version.equals(pending)) throw new IllegalStateException("update_metadata_missing");
    }

    private void enqueuePersistedUpdate(String version) {
        enqueuePersistedUpdate(getContext(), version);
    }

    private static void enqueuePersistedUpdate(android.content.Context context, String version) {
        requirePendingVersion(context, version);
        android.content.SharedPreferences prefs = context.getSharedPreferences(PREFS, 0);
        String url = prefs.getString(PREF_PENDING_URL, "");
        long size = prefs.getLong(PREF_PENDING_SIZE, 0);
        String digest = prefs.getString(PREF_PENDING_DIGEST, null);
        String sidecar = prefs.getString(PREF_PENDING_SIDECAR, "");
        try {
            UpdateDownloadPolicy.requireInitialReleaseUrl(url);
            if (size <= 0 || size > UpdateDownloadPolicy.MAX_APK_BYTES) throw new IllegalArgumentException("update_size_invalid");
            if (UpdateDownloadPolicy.parseSha256(digest) == null && (sidecar == null || sidecar.isEmpty())) {
                throw new IllegalArgumentException("update_digest_required");
            }
            if (sidecar != null && !sidecar.isEmpty()) UpdateDownloadPolicy.requireInitialReleaseUrl(sidecar);
        } catch (Exception error) {
            throw new IllegalStateException(fixedReason(error, "invalid_update_metadata"));
        }
        Data input = new Data.Builder()
            .putString(YachiyoUpdateWorker.VERSION, version)
            .putString(YachiyoUpdateWorker.URL_KEY, url)
            .putLong(YachiyoUpdateWorker.SIZE, size)
            .putString(YachiyoUpdateWorker.DIGEST, digest)
            .putString(YachiyoUpdateWorker.SIDECAR, sidecar == null || sidecar.isEmpty() ? null : sidecar)
            .build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(YachiyoUpdateWorker.class)
            .setInputData(input)
            .setConstraints(io.github.yachiyoclaw.download.YachiyoDownloadSettingsPlugin.constraints(context))
            .addTag("yachiyo-update")
            .build();
        WorkManager.getInstance(context).enqueueUniqueWork(workName(version), ExistingWorkPolicy.REPLACE, request);
    }

    /** Replaces an active APK worker so the latest global network constraint is applied. */
    public static void reapplyActiveDownloadConstraints(android.content.Context context) {
        String version = context.getSharedPreferences(PREFS, 0).getString(PREF_PENDING_VERSION, "");
        if (version == null || version.isEmpty()) return;
        String status = DownloadTaskStore.status(context, "update-" + version);
        if ("queued".equals(status) || "downloading".equals(status)) enqueuePersistedUpdate(context, version);
    }

    private void clearVerifiedUpdateIfDifferent(String version) {
        try {
            File verified = loadAndVerifyPersistedFile();
            if (verified.getName().equals("update-" + version + ".apk")) return;
            if (!verified.delete()) verified.deleteOnExit();
        } catch (Exception ignored) {}
        getContext().getSharedPreferences(PREFS, 0).edit().remove(PREF_FILE).remove(PREF_DIGEST).apply();
    }

    @PluginMethod
    public void getInstallPermission(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", getContext().getPackageManager().canRequestPackageInstalls());
        call.resolve(result);
    }

    @PluginMethod
    public void openInstallPermissionSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void installUpdate(PluginCall call) {
        if (!getContext().getPackageManager().canRequestPackageInstalls()) {
            JSObject result = new JSObject();
            result.put("permissionRequired", true);
            call.resolve(result);
            return;
        }
        executor.submit(() -> {
            try {
                File apk = loadAndVerifyPersistedFile();
                UpdatePackageVerifier.requireTrusted(getContext(), apk);
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
                Intent install = new Intent(Intent.ACTION_VIEW);
                install.setDataAndType(uri, APK_MIME);
                install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                // Android PackageManager performs the final package signature and signing-lineage verification.
                getContext().startActivity(install);
                JSObject result = new JSObject();
                result.put("permissionRequired", false);
                call.resolve(result);
            } catch (Exception error) {
                call.reject(fixedReason(error, "update_install_failed"));
            }
        });
    }

    /**
     * Resolves the persisted verified APK, re-checking its SHA-256 and that it lives inside the
     * app-private verified-updates directory (the same {@code filesDir} location the worker writes to).
     */
    private File loadAndVerifyPersistedFile() throws Exception {
        String path = getContext().getSharedPreferences(PREFS, 0).getString(PREF_FILE, null);
        String expected = UpdateDownloadPolicy.parseSha256(getContext().getSharedPreferences(PREFS, 0).getString(PREF_DIGEST, null));
        File verifiedRoot = new File(getContext().getFilesDir(), UPDATE_DIR).getCanonicalFile();
        File apk = path == null ? null : new File(path).getCanonicalFile();
        if (apk == null || expected == null || !apk.isFile() || !apk.getParentFile().equals(verifiedRoot)) {
            throw new IOException("verified_update_missing");
        }
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new BufferedInputStream(new FileInputStream(apk))) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) digest.update(buffer, 0, read);
        }
        if (!MessageDigest.isEqual(hexBytes(expected), digest.digest())) throw new IOException("update_digest_mismatch");
        return apk;
    }

    private static byte[] hexBytes(String value) {
        byte[] result = new byte[value.length() / 2];
        for (int i = 0; i < result.length; i++) result[i] = (byte) Integer.parseInt(value.substring(i * 2, i * 2 + 2), 16);
        return result;
    }

    private static String fixedReason(Exception error, String fallback) {
        String message = error.getMessage();
        return message != null && message.matches("[a-z0-9_]{3,80}") ? message : fallback;
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        super.handleOnDestroy();
    }
}
