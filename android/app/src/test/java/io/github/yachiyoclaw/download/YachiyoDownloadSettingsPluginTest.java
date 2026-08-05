package io.github.yachiyoclaw.download;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class YachiyoDownloadSettingsPluginTest {
    @Test
    public void parsesCloudflareCountryWithoutAcceptingArbitraryValues() {
        assertEquals("CN", YachiyoDownloadSettingsPlugin.parseTraceCountry("fl=1\nloc=cn\ntls=TLSv1.3\n"));
        assertEquals("US", YachiyoDownloadSettingsPlugin.parseTraceCountry("loc=US\n"));
        assertEquals("", YachiyoDownloadSettingsPlugin.parseTraceCountry("loc=CHN\n"));
        assertEquals("", YachiyoDownloadSettingsPlugin.parseTraceCountry("ip=127.0.0.1\n"));
    }

    @Test
    public void rewritesOnlyPinnedAlpineOriginWhenMirrorIsEnabled() {
        String official = "https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/aarch64/rootfs.tar.gz";
        assertEquals(
            "https://mirrors.tuna.tsinghua.edu.cn/alpine/v3.24/releases/aarch64/rootfs.tar.gz",
            YachiyoDownloadSettingsPlugin.mirrorAlpineUrl(true, official)
        );
        assertEquals(official, YachiyoDownloadSettingsPlugin.mirrorAlpineUrl(false, official));
        assertEquals(
            "https://example.com/rootfs.tar.gz",
            YachiyoDownloadSettingsPlugin.mirrorAlpineUrl(true, "https://example.com/rootfs.tar.gz")
        );
    }

    @Test
    public void exposesThePinnedOfficialAndroidToolchainFallback() {
        assertEquals(
            "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip",
            YachiyoDownloadSettingsPlugin.officialAndroidCommandlineToolsUrl()
        );
    }
}
