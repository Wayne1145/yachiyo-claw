package io.github.yachiyoclaw.update;

import java.net.MalformedURLException;
import java.net.URL;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class UpdateDownloadPolicy {
    static final long MAX_APK_BYTES = 512L * 1024L * 1024L;
    static final int MAX_SIDECAR_BYTES = 4096;
    static final int MAX_REDIRECTS = 5;
    private static final String RELEASE_PREFIX = "/wayne1145/yachiyo-claw/releases/download/";
    private static final Pattern SHA256 = Pattern.compile("(?i)^\\s*(?:sha256:)?([0-9a-f]{64})(?:\\s+[*]?.+)?\\s*$");

    private UpdateDownloadPolicy() {}

    static URL requireInitialReleaseUrl(String value) throws MalformedURLException {
        URL url = new URL(value == null ? "" : value);
        if (!isHttps(url) || !"github.com".equalsIgnoreCase(url.getHost()) || url.getPort() != -1) {
            throw new IllegalArgumentException("update_url_not_allowed");
        }
        if (!url.getPath().toLowerCase(Locale.ROOT).startsWith(RELEASE_PREFIX)) {
            throw new IllegalArgumentException("update_url_not_allowed");
        }
        return url;
    }

    static void requireAllowedRedirect(URL url) {
        if (!isHttps(url) || url.getPort() != -1) throw new IllegalArgumentException("update_redirect_not_allowed");
        String host = url.getHost().toLowerCase(Locale.ROOT);
        boolean githubRelease = "github.com".equals(host) && url.getPath().toLowerCase(Locale.ROOT).startsWith(RELEASE_PREFIX);
        boolean githubAssetCdn = "release-assets.githubusercontent.com".equals(host);
        if (!githubRelease && !githubAssetCdn) throw new IllegalArgumentException("update_redirect_not_allowed");
    }

    static String parseSha256(String value) {
        if (value == null) return null;
        Matcher matcher = SHA256.matcher(value);
        return matcher.matches() ? matcher.group(1).toLowerCase(Locale.ROOT) : null;
    }

    static String safeVersion(String value) {
        if (value == null || !value.matches("[0-9A-Za-z._-]{1,64}")) {
            throw new IllegalArgumentException("invalid_update_version");
        }
        return value;
    }

    private static boolean isHttps(URL url) {
        return "https".equalsIgnoreCase(url.getProtocol()) && url.getUserInfo() == null;
    }
}
