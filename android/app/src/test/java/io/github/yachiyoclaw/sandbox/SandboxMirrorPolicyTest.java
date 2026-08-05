package io.github.yachiyoclaw.sandbox;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

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
}
