package io.github.yachiyoclaw.security;

final class CapacitorNavigationPolicy {
    private CapacitorNavigationPolicy() {}

    static boolean blocksDocumentPath(String decodedPath) {
        return decodedPath != null && decodedPath.startsWith("/_capacitor_http_interceptor_");
    }
}
