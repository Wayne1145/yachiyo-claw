package io.github.yachiyoclaw.security;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import org.junit.Test;

public final class YachiyoSecureStoragePluginTest {
    @Test
    public void bindsAadToTheExactPluginStorageLocation() {
        byte[] first = YachiyoSecureStoragePlugin.aadForContext("plugin-data/v2/plugin%3Afirst%3Atoken");
        byte[] second = YachiyoSecureStoragePlugin.aadForContext("plugin-data/v2/plugin%3Asecond%3Atoken");

        assertFalse(Arrays.equals(first, second));
        assertArrayEquals(
            "io.github.yachiyoclaw/protected/v2/plugin-data/v2/plugin%3Afirst%3Atoken".getBytes(StandardCharsets.UTF_8),
            first
        );
    }

    @Test
    public void rejectsMalformedProtectionContexts() {
        assertThrows(
            IllegalArgumentException.class,
            () -> YachiyoSecureStoragePlugin.normalizeProtectionContext("plugin-data\nother")
        );
    }
}
