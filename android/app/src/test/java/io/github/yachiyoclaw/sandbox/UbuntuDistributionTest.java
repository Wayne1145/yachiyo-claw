package io.github.yachiyoclaw.sandbox;

import static org.junit.Assert.*;
import org.junit.Test;

public final class UbuntuDistributionTest {
    @Test public void mapsSupportedAndroidAbisToPinnedCanonicalArtifacts() {
        UbuntuDistribution.Spec arm64 = UbuntuDistribution.forAbi("arm64-v8a");
        UbuntuDistribution.Spec x64 = UbuntuDistribution.forAbi("x86_64");
        assertNotNull(arm64);
        assertEquals("arm64", arm64.dpkgArch());
        assertEquals(29_870_567L, arm64.size());
        assertEquals("04207713ece899c3740823d33690441ad3a7f0ded1101aca744e2b0f37ac7ff2", arm64.sha256());
        assertNotNull(x64);
        assertEquals("amd64", x64.dpkgArch());
        assertEquals(29_989_394L, x64.size());
        assertEquals("c1e67ef7b17a6300e136118bd1dc04725009cb376c1aad10abcf8cd453628d58", x64.sha256());
        assertNull(UbuntuDistribution.forAbi("armeabi-v7a"));
    }

    @Test public void downloadIdsAreStableAndArchitectureSpecific() {
        assertEquals("ubuntu-24.04-arm64", UbuntuDistribution.forAbi("aarch64").downloadId());
        assertEquals("ubuntu-24.04-amd64", UbuntuDistribution.forAbi("amd64").downloadId());
    }
}
