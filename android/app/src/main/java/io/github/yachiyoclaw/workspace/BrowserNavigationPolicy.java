package io.github.yachiyoclaw.workspace;

import java.net.URI;
import java.net.URISyntaxException;

final class BrowserNavigationPolicy {
    private BrowserNavigationPolicy() {}

    static boolean isAllowed(String value, boolean previewOnly) {
        if (value == null || value.length() > 8_192 || value.indexOf('\0') >= 0) return false;
        final URI uri;
        try {
            uri = new URI(value);
        } catch (URISyntaxException error) {
            return false;
        }
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (scheme == null || host == null) return false;
        boolean loopback = host.equalsIgnoreCase("localhost") || host.equals("127.0.0.1") || host.equals("[::1]") || host.equals("::1");
        if (previewOnly) return loopback && scheme.equalsIgnoreCase("http");
        return scheme.equalsIgnoreCase("https") || (loopback && scheme.equalsIgnoreCase("http"));
    }
}
