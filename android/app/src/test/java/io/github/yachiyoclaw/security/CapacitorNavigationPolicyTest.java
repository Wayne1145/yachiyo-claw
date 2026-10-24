package io.github.yachiyoclaw.security;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import java.net.URI;
import org.junit.Test;

public class CapacitorNavigationPolicyTest {
    @Test public void blocksProxyDocument() {
        assertTrue(CapacitorNavigationPolicy.blocksDocumentPath("/_capacitor_http_interceptor_"));
    }

    @Test public void blocksProxyPrefixVariants() {
        assertTrue(CapacitorNavigationPolicy.blocksDocumentPath("/_capacitor_http_interceptor_/remote"));
        assertTrue(CapacitorNavigationPolicy.blocksDocumentPath("/_capacitor_http_interceptor_suffix"));
    }

    @Test public void blocksDecodedEscapes() throws Exception {
        String path = new URI("https://localhost/%5Fcapacitor_http_interceptor_?u=https://example.com").getPath();
        assertTrue(CapacitorNavigationPolicy.blocksDocumentPath(path));
    }

    @Test public void preservesOrdinaryDocumentsAndSettings() {
        assertFalse(CapacitorNavigationPolicy.blocksDocumentPath("/"));
        assertFalse(CapacitorNavigationPolicy.blocksDocumentPath("/index.html"));
        assertFalse(CapacitorNavigationPolicy.blocksDocumentPath("/settings/realtime"));
    }

    @Test public void preservesPathlessNavigation() {
        assertFalse(CapacitorNavigationPolicy.blocksDocumentPath(null));
        assertFalse(CapacitorNavigationPolicy.blocksDocumentPath(""));
    }
}
