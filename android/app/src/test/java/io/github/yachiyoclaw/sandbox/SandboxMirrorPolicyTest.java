package io.github.yachiyoclaw.sandbox;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;
import io.github.yachiyoclaw.download.YachiyoDownloadSettingsPlugin;

public class SandboxMirrorPolicyTest {
    @Test
    public void mainlandMirrorConfiguresAlpinePipAndNpm() {
        String repositories = YachiyoSandboxPlugin.linuxMirrorSetupCommand(true);
        String registries = YachiyoSandboxPlugin.developerRegistrySetupCommand(true);
        assertTrue(repositories.contains("mirrors.tuna.tsinghua.edu.cn/alpine/v3.24/main"));
        assertTrue(repositories.contains("/etc/apk/repositories"));
        assertTrue(registries.contains("pypi.tuna.tsinghua.edu.cn/simple"));
        assertTrue(registries.contains("registry.npmmirror.com"));
    }

    @Test
    public void disabledMirrorDoesNotRewriteGuestConfiguration() {
        assertEquals("", YachiyoSandboxPlugin.linuxMirrorSetupCommand(false));
        assertEquals("", YachiyoSandboxPlugin.developerRegistrySetupCommand(false));
    }

    @Test public void ubuntuMirrorPreservesPinnedReleasePath() {
        String origin = "https://cdimage.ubuntu.com/ubuntu-base/releases/24.04.4/release/ubuntu-base.tar.gz";
        assertEquals(
            "https://mirrors.tuna.tsinghua.edu.cn/ubuntu-cdimage/ubuntu-base/releases/24.04.4/release/ubuntu-base.tar.gz",
            YachiyoDownloadSettingsPlugin.mirrorUbuntuImageUrl(true, origin)
        );
        assertEquals(origin, YachiyoDownloadSettingsPlugin.mirrorUbuntuImageUrl(false, origin));
    }
}
