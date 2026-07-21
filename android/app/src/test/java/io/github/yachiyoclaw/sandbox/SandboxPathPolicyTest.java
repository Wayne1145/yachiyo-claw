package io.github.yachiyoclaw.sandbox;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import java.io.File;
import org.junit.Test;

public class SandboxPathPolicyTest {
    @Test
    public void confinesPathsToWorkspace() throws Exception {
        File root = new File(System.getProperty("java.io.tmpdir"), "yachiyo-workspace").getCanonicalFile();
        assertEquals(new File(root, "src/index.ts").getCanonicalFile(), SandboxPathPolicy.resolveWorkspace(root, "src/index.ts"));
        assertThrows(IllegalArgumentException.class, () -> SandboxPathPolicy.resolveWorkspace(root, "../secret"));
        assertThrows(IllegalArgumentException.class, () -> SandboxPathPolicy.resolveWorkspace(root, "/etc/passwd"));
    }

    @Test
    public void quotesShellArguments() {
        assertEquals("'a'\\''b'", SandboxPathPolicy.shellQuote("a'b"));
    }
}
