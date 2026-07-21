package io.github.yachiyoclaw.sandbox;

import android.os.Build;
import java.util.Locale;

final class SandboxDistribution {
    static final String VERSION = "alpine-3.24.1-v1";
    static final long MAX_ARCHIVE_BYTES = 32L * 1024L * 1024L;
    static final long MAX_EXTRACTED_BYTES = 512L * 1024L * 1024L;

    private SandboxDistribution() {}

    static Spec current() {
        for (String abi : Build.SUPPORTED_ABIS) {
            Spec spec = forAbi(abi);
            if (spec != null) return spec;
        }
        return null;
    }

    static Spec current(String nativeLibraryDirectory) {
        String directory = nativeLibraryDirectory == null ? "" : nativeLibraryDirectory.replace('\\', '/').toLowerCase(Locale.ROOT);
        if (directory.endsWith("/arm64") || directory.endsWith("/arm64-v8a")) return forAbi("arm64-v8a");
        if (directory.endsWith("/x86_64")) return forAbi("x86_64");
        return current();
    }

    static Spec forAbi(String abi) {
        String value = abi == null ? "" : abi.toLowerCase(Locale.ROOT);
        if (value.equals("arm64-v8a") || value.equals("aarch64")) {
            return new Spec(
                "arm64-v8a",
                "aarch64",
                "https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/aarch64/alpine-minirootfs-3.24.1-aarch64.tar.gz",
                4_023_732L,
                "f55a90f69052c5bd6f92cb09a8f47065970830b194c917a006fb94028e721259"
            );
        }
        if (value.equals("x86_64")) {
            return new Spec(
                "x86_64",
                "x86_64",
                "https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/x86_64/alpine-minirootfs-3.24.1-x86_64.tar.gz",
                3_698_422L,
                "41f73e3cf5fa919b8aa5ca6b30dc48f0da2720776d7423e2a7748211456fe081"
            );
        }
        return null;
    }

    record Spec(String androidAbi, String alpineArch, String url, long size, String sha256) {}
}
