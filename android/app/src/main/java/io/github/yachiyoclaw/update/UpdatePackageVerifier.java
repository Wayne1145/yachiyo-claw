package io.github.yachiyoclaw.update;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import java.io.File;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Set;

/** Verifies package identity and signing lineage before an APK is exposed to the system installer. */
final class UpdatePackageVerifier {
    private UpdatePackageVerifier() {}

    static void requireTrusted(Context context, File apk) throws Exception {
        PackageManager manager = context.getPackageManager();
        PackageInfo archive = manager.getPackageArchiveInfo(apk.getAbsolutePath(), PackageManager.GET_SIGNING_CERTIFICATES);
        PackageInfo installed = manager.getPackageInfo(context.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
        if (archive == null || installed == null || !context.getPackageName().equals(archive.packageName)
            || archive.signingInfo == null || installed.signingInfo == null) {
            throw new SecurityException("update_package_invalid");
        }
        Set<String> trusted = fingerprints(installed.signingInfo);
        Set<String> candidate = fingerprints(archive.signingInfo);
        if (trusted.isEmpty() || candidate.isEmpty() || java.util.Collections.disjoint(trusted, candidate)) {
            throw new SecurityException("update_signature_mismatch");
        }
        requireVersionIncrease(installed.getLongVersionCode(), archive.getLongVersionCode());
    }

    static void requireVersionIncrease(long installedVersion, long candidateVersion) {
        if (candidateVersion <= installedVersion) {
            throw new IllegalArgumentException("update_version_not_newer");
        }
    }

    private static Set<String> fingerprints(SigningInfo info) throws Exception {
        Signature[] signatures = info.hasMultipleSigners() ? info.getApkContentsSigners() : info.getSigningCertificateHistory();
        if (signatures == null || signatures.length == 0) signatures = info.getApkContentsSigners();
        Set<String> result = new HashSet<>();
        if (signatures == null) return result;
        for (Signature signature : signatures) {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(signature.toByteArray());
            StringBuilder value = new StringBuilder();
            for (byte item : digest) value.append(String.format("%02x", item));
            result.add(value.toString());
        }
        return result;
    }
}
