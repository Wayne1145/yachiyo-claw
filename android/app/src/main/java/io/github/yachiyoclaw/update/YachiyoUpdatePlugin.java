package io.github.yachiyoclaw.update;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "YachiyoUpdate")
public final class YachiyoUpdatePlugin extends Plugin {
    private static final String PREFS = "yachiyo-update";
    private static final String PREF_FILE = "verified-file";
    private static final String PREF_DIGEST = "verified-digest";
    private static final String APK_MIME = "application/vnd.android.package-archive";
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean downloadRunning = new AtomicBoolean(false);

    @PluginMethod
    public void downloadUpdate(PluginCall call) {
        if (!downloadRunning.compareAndSet(false, true)) {
            call.reject("update_download_in_progress");
            return;
        }
        final String version;
        final URL apkUrl;
        final URL sidecarUrl;
        final String providedDigest;
        final long expectedSize = Math.max(0L, call.getLong("size", 0L));
        try {
            version = UpdateDownloadPolicy.safeVersion(call.getString("version"));
            apkUrl = UpdateDownloadPolicy.requireInitialReleaseUrl(call.getString("url"));
            providedDigest = UpdateDownloadPolicy.parseSha256(call.getString("sha256"));
            String sidecar = call.getString("sha256SidecarUrl");
            sidecarUrl = sidecar == null || sidecar.isBlank() ? null : UpdateDownloadPolicy.requireInitialReleaseUrl(sidecar);
            if (providedDigest == null && sidecarUrl == null) throw new IllegalArgumentException("update_digest_required");
            if (expectedSize > UpdateDownloadPolicy.MAX_APK_BYTES) throw new IllegalArgumentException("update_too_large");
        } catch (Exception error) {
            downloadRunning.set(false);
            call.reject(fixedReason(error, "invalid_update_metadata"));
            return;
        }

        executor.submit(() -> {
            File partial = null;
            try {
                String expectedDigest = providedDigest != null ? providedDigest : downloadSidecarDigest(sidecarUrl);
                File updateDirectory = new File(getContext().getCacheDir(), "verified-updates");
                if (!updateDirectory.exists() && !updateDirectory.mkdirs()) throw new IOException("update_cache_unavailable");
                clearUpdateDirectory(updateDirectory);
                partial = new File(updateDirectory, "update-" + version + ".apk.partial");
                File verified = new File(updateDirectory, "update-" + version + ".apk");
                String actualDigest = downloadApk(apkUrl, partial, expectedSize);
                if (!MessageDigest.isEqual(hexBytes(expectedDigest), hexBytes(actualDigest))) {
                    throw new IOException("update_digest_mismatch");
                }
                validatePackage(partial);
                try {
                    Files.move(partial.toPath(), verified.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
                } catch (AtomicMoveNotSupportedException ignored) {
                    Files.move(partial.toPath(), verified.toPath(), StandardCopyOption.REPLACE_EXISTING);
                }
                persistVerifiedFile(verified, actualDigest);

                JSObject event = new JSObject();
                event.put("version", version);
                notifyListeners("downloaded", event, true);
                call.resolve(event);
            } catch (Exception error) {
                if (partial != null) partial.delete();
                clearVerifiedFile();
                String reason = fixedReason(error, "update_download_failed");
                JSObject event = new JSObject();
                event.put("message", reason);
                notifyListeners("error", event, true);
                call.reject(reason);
            } finally {
                downloadRunning.set(false);
            }
        });
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
                validatePackage(apk);
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

    private String downloadSidecarDigest(URL sidecarUrl) throws Exception {
        HttpURLConnection connection = openFollowingValidatedRedirects(sidecarUrl);
        try (InputStream input = new BufferedInputStream(connection.getInputStream());
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[1024];
            int total = 0;
            int read;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > UpdateDownloadPolicy.MAX_SIDECAR_BYTES) throw new IOException("update_sidecar_too_large");
                output.write(buffer, 0, read);
            }
            String digest = UpdateDownloadPolicy.parseSha256(output.toString(StandardCharsets.UTF_8));
            if (digest == null) throw new IOException("update_sidecar_invalid");
            return digest;
        } finally {
            connection.disconnect();
        }
    }

    private String downloadApk(URL apkUrl, File target, long expectedSize) throws Exception {
        HttpURLConnection connection = openFollowingValidatedRedirects(apkUrl);
        long responseSize = connection.getContentLengthLong();
        if (responseSize > UpdateDownloadPolicy.MAX_APK_BYTES) {
            connection.disconnect();
            throw new IOException("update_too_large");
        }
        if (expectedSize > 0 && responseSize > 0 && expectedSize != responseSize) {
            connection.disconnect();
            throw new IOException("update_size_mismatch");
        }

        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long total = responseSize > 0 ? responseSize : expectedSize;
        long transferred = 0;
        long lastEventAt = 0;
        try (InputStream input = new BufferedInputStream(connection.getInputStream());
             FileOutputStream output = new FileOutputStream(target)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                transferred += read;
                if (transferred > UpdateDownloadPolicy.MAX_APK_BYTES) throw new IOException("update_too_large");
                output.write(buffer, 0, read);
                digest.update(buffer, 0, read);
                long now = System.currentTimeMillis();
                if (now - lastEventAt >= 200) {
                    emitProgress(transferred, total);
                    lastEventAt = now;
                }
            }
            output.getFD().sync();
        } finally {
            connection.disconnect();
        }
        if (expectedSize > 0 && transferred != expectedSize) throw new IOException("update_size_mismatch");
        emitProgress(transferred, total > 0 ? total : transferred);
        return toHex(digest.digest());
    }

    private HttpURLConnection openFollowingValidatedRedirects(URL initial) throws Exception {
        URL current = initial;
        for (int redirects = 0; redirects <= UpdateDownloadPolicy.MAX_REDIRECTS; redirects++) {
            UpdateDownloadPolicy.requireAllowedRedirect(current);
            HttpURLConnection connection = (HttpURLConnection) current.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(30_000);
            connection.setRequestProperty("Accept", "application/octet-stream");
            connection.setRequestProperty("User-Agent", "Yachiyo-Claw-Android-Updater");
            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null || redirects == UpdateDownloadPolicy.MAX_REDIRECTS) {
                    throw new IOException("update_redirect_invalid");
                }
                current = new URL(current, location);
                continue;
            }
            if (status != HttpURLConnection.HTTP_OK) {
                connection.disconnect();
                throw new IOException("update_http_" + status);
            }
            return connection;
        }
        throw new IOException("update_redirect_invalid");
    }

    private void validatePackage(File apk) throws IOException {
        PackageInfo info = getContext().getPackageManager().getPackageArchiveInfo(apk.getAbsolutePath(), PackageManager.GET_SIGNING_CERTIFICATES);
        if (info == null || !getContext().getPackageName().equals(info.packageName) || info.signingInfo == null) {
            throw new IOException("update_package_invalid");
        }
    }

    private void emitProgress(long transferred, long total) {
        JSObject event = new JSObject();
        event.put("transferred", transferred);
        event.put("total", total);
        event.put("percent", total > 0 ? Math.min(100, Math.round(transferred * 100.0 / total)) : 0);
        event.put("bytesPerSecond", 0);
        notifyListeners("progress", event, true);
    }

    private void persistVerifiedFile(File file, String digest) {
        getContext().getSharedPreferences(PREFS, 0).edit()
            .putString(PREF_FILE, file.getAbsolutePath())
            .putString(PREF_DIGEST, digest)
            .apply();
    }

    private File loadAndVerifyPersistedFile() throws Exception {
        String path = getContext().getSharedPreferences(PREFS, 0).getString(PREF_FILE, null);
        String expected = UpdateDownloadPolicy.parseSha256(getContext().getSharedPreferences(PREFS, 0).getString(PREF_DIGEST, null));
        File cacheRoot = new File(getContext().getCacheDir(), "verified-updates").getCanonicalFile();
        File apk = path == null ? null : new File(path).getCanonicalFile();
        if (apk == null || expected == null || !apk.isFile() || !apk.getParentFile().equals(cacheRoot)) {
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

    private void clearVerifiedFile() {
        getContext().getSharedPreferences(PREFS, 0).edit().clear().apply();
    }

    private static void clearUpdateDirectory(File directory) {
        File[] files = directory.listFiles();
        if (files != null) for (File file : files) file.delete();
    }

    private static byte[] hexBytes(String value) {
        byte[] result = new byte[value.length() / 2];
        for (int i = 0; i < result.length; i++) result[i] = (byte) Integer.parseInt(value.substring(i * 2, i * 2 + 2), 16);
        return result;
    }

    private static String toHex(byte[] value) {
        StringBuilder result = new StringBuilder(value.length * 2);
        for (byte item : value) result.append(String.format("%02x", item));
        return result.toString();
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
