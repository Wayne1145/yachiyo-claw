package io.github.yachiyoclaw.workspace;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import org.junit.Test;

public class BrowserNavigationPolicyTest {
    @Test public void browserAllowsHttpsAndLoopbackPreview() {
        assertTrue(BrowserNavigationPolicy.isAllowed("https://example.com/path", false));
        assertTrue(BrowserNavigationPolicy.isAllowed("http://127.0.0.1:5173/", false));
        assertFalse(BrowserNavigationPolicy.isAllowed("http://example.com/", false));
    }

    @Test public void previewIsStrictlyLoopbackHttp() {
        assertTrue(BrowserNavigationPolicy.isAllowed("http://localhost:3000/", true));
        assertFalse(BrowserNavigationPolicy.isAllowed("https://example.com/", true));
        assertFalse(BrowserNavigationPolicy.isAllowed("file:///data/data/private", true));
        assertFalse(BrowserNavigationPolicy.isAllowed("javascript:alert(1)", false));
    }
}
