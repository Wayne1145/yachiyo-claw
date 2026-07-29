package io.github.yachiyoclaw.artifact;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.security.MessageDigest;

@CapacitorPlugin(name = "YachiyoArtifact")
public final class YachiyoArtifactPlugin extends Plugin {
    private static final long MAX_APK_BYTES = 512L * 1024L * 1024L;

    @PluginMethod
    public void inspectApk(PluginCall call) {
        try {
            File apk = requireApk(call);
            call.resolve(describe(apk));
        } catch (Exception error) {
            call.reject(safeError(error, "artifact_inspect_failed"));
        }
    }

    @PluginMethod
    public void installApk(PluginCall call) {
        try {
            File source = requireApk(call);
            String expected = call.getString("expectedSha256", "");
            String actual = sha256(source);
            if (!actual.equals(expected)) throw new SecurityException("artifact_digest_mismatch");
            PackageInfo info = packageInfo(source);
            if (getContext().getPackageName().equals(info.packageName)) throw new SecurityException("artifact_host_package_blocked");
            File directory = new File(getContext().getCacheDir(), "workspace-artifacts");
            if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("artifact_cache_unavailable");
            File destination = new File(directory, actual + ".apk");
            if (!destination.isFile()) copy(source, destination);
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", destination);
            Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve(new JSObject().put("accepted", true).put("packageName", info.packageName).put("sha256", actual));
        } catch (Exception error) {
            call.reject(safeError(error, "artifact_install_failed"));
        }
    }

    @PluginMethod
    public void packageStatus(PluginCall call) {
        String packageName = call.getString("packageName", "");
        try {
            PackageInfo info = getContext().getPackageManager().getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES);
            call.resolve(new JSObject().put("installed", true).put("packageName", packageName)
                .put("versionName", info.versionName).put("versionCode", info.getLongVersionCode()));
        } catch (PackageManager.NameNotFoundException missing) {
            call.resolve(new JSObject().put("installed", false).put("packageName", packageName));
        }
    }

    @PluginMethod
    public void launchPackage(PluginCall call) {
        String packageName = call.getString("packageName", "");
        Intent intent = getContext().getPackageManager().getLaunchIntentForPackage(packageName);
        if (intent == null) { call.reject("artifact_package_not_launchable"); return; }
        getContext().startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        call.resolve(new JSObject().put("launched", true));
    }

    @PluginMethod
    public void installPermission(PluginCall call) {
        boolean allowed = Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls();
        call.resolve(new JSObject().put("allowed", allowed));
    }

    @PluginMethod
    public void openInstallPermission(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:" + getContext().getPackageName())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve(new JSObject().put("opened", true));
    }

    private File requireApk(PluginCall call) throws Exception {
        File workspace = ArtifactPathPolicy.workspace(getContext().getFilesDir(), call.getString("workspaceKey", ""));
        File apk = ArtifactPathPolicy.resolve(workspace, call.getString("path", ""));
        if (!apk.isFile() || !apk.getName().toLowerCase(java.util.Locale.ROOT).endsWith(".apk")) throw new IllegalArgumentException("artifact_apk_invalid");
        if (apk.length() <= 0 || apk.length() > MAX_APK_BYTES) throw new IllegalArgumentException("artifact_apk_size_invalid");
        packageInfo(apk);
        return apk;
    }

    private PackageInfo packageInfo(File apk) {
        PackageInfo info = getContext().getPackageManager().getPackageArchiveInfo(apk.getAbsolutePath(),
            PackageManager.GET_PERMISSIONS | PackageManager.GET_SIGNING_CERTIFICATES);
        if (info == null || info.packageName == null || info.signingInfo == null) throw new IllegalArgumentException("artifact_package_invalid");
        return info;
    }

    private JSObject describe(File apk) throws Exception {
        PackageInfo info = packageInfo(apk);
        JSArray permissions = new JSArray();
        if (info.requestedPermissions != null) for (String permission : info.requestedPermissions) permissions.put(permission);
        Signature[] signatures = info.signingInfo.hasMultipleSigners() ? info.signingInfo.getApkContentsSigners() : info.signingInfo.getSigningCertificateHistory();
        String signer = signatures == null || signatures.length == 0 ? "" : digest(signatures[0].toByteArray());
        boolean installed = true;
        String installedSigner = "";
        try {
            PackageInfo current = getContext().getPackageManager().getPackageInfo(info.packageName, PackageManager.GET_SIGNING_CERTIFICATES);
            Signature[] currentSignatures = current.signingInfo == null ? new Signature[0]
                : current.signingInfo.hasMultipleSigners() ? current.signingInfo.getApkContentsSigners() : current.signingInfo.getSigningCertificateHistory();
            if (currentSignatures != null && currentSignatures.length > 0) installedSigner = digest(currentSignatures[0].toByteArray());
        } catch (PackageManager.NameNotFoundException missing) { installed = false; }
        return new JSObject().put("path", apk.getName()).put("size", apk.length()).put("sha256", sha256(apk))
            .put("packageName", info.packageName).put("versionName", info.versionName).put("versionCode", info.getLongVersionCode())
            .put("signerSha256", signer).put("permissions", permissions).put("installed", installed)
            .put("signatureMatchesInstalled", !installed || signer.equals(installedSigner))
            .put("hostPackageBlocked", getContext().getPackageName().equals(info.packageName));
    }

    private static String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (FileInputStream input = new FileInputStream(file)) { byte[] buffer = new byte[64 * 1024]; int read; while ((read = input.read(buffer)) >= 0) digest.update(buffer, 0, read); }
        return hex(digest.digest());
    }

    private static String digest(byte[] value) throws Exception { return hex(MessageDigest.getInstance("SHA-256").digest(value)); }
    private static String hex(byte[] value) { StringBuilder out = new StringBuilder(); for (byte item : value) out.append(String.format("%02x", item)); return out.toString(); }
    private static void copy(File source, File destination) throws Exception {
        try (FileInputStream input = new FileInputStream(source); FileOutputStream output = new FileOutputStream(destination)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) >= 0) output.write(buffer, 0, read);
            output.getFD().sync();
        }
    }
    private static String safeError(Exception error, String fallback) { String message = error.getMessage(); return message != null && message.matches("[A-Za-z0-9._-]{1,120}") ? message : fallback; }
}
