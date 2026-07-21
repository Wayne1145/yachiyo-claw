package io.github.yachiyoclaw.sandbox;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;

import org.junit.Test;

public class SandboxDistributionTest {
    @Test
    public void mapsSupportedAndroidAbis() {
        assertEquals("aarch64", SandboxDistribution.forAbi("arm64-v8a").alpineArch());
        assertEquals("x86_64", SandboxDistribution.forAbi("x86_64").alpineArch());
        assertNull(SandboxDistribution.forAbi("armeabi-v7a"));
        assertEquals("aarch64", SandboxDistribution.current("/data/app/example/lib/arm64").alpineArch());
        assertEquals("x86_64", SandboxDistribution.current("/data/app/example/lib/x86_64").alpineArch());
    }

    @Test
    public void archivePathsRejectHostEscapes() {
        assertEquals("bin/busybox", AlpineSandboxInstaller.normalizeArchivePath("./bin/busybox"));
        assertThrows(IllegalArgumentException.class, () -> AlpineSandboxInstaller.normalizeArchivePath("../../data/secret"));
        assertThrows(IllegalArgumentException.class, () -> AlpineSandboxInstaller.normalizeArchivePath("/data/secret"));
    }
}
