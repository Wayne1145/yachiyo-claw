package io.github.yachiyoclaw.sandbox;

import android.os.Build;
import java.util.Locale;

/** Immutable Canonical Ubuntu Base 24.04.4 descriptors supported by the official plugin. */
final class UbuntuDistribution {
    static final String RUNTIME_ID = "ubuntu-24.04";
    static final String VERSION = "ubuntu-base-24.04.4-v1";
    static final long MAX_EXTRACTED_BYTES = 1024L * 1024L * 1024L;

    private UbuntuDistribution() {}

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
        String base = "https://cdimage.ubuntu.com/ubuntu-base/releases/24.04.4/release/";
        if (value.equals("arm64-v8a") || value.equals("aarch64")) {
            return new Spec(
                "arm64-v8a", "arm64", "arm64", base + "ubuntu-base-24.04.4-base-arm64.tar.gz",
                29_870_567L, "04207713ece899c3740823d33690441ad3a7f0ded1101aca744e2b0f37ac7ff2"
            );
        }
        if (value.equals("x86_64") || value.equals("amd64")) {
            return new Spec(
                "x86_64", "amd64", "amd64", base + "ubuntu-base-24.04.4-base-amd64.tar.gz",
                29_989_394L, "c1e67ef7b17a6300e136118bd1dc04725009cb376c1aad10abcf8cd453628d58"
            );
        }
        return null;
    }

    record Spec(String androidAbi, String archiveArch, String dpkgArch, String url, long size, String sha256) {
        String downloadId() { return "ubuntu-24.04-" + archiveArch; }
    }
}
