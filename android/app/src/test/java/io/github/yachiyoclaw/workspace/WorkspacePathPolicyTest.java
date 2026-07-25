package io.github.yachiyoclaw.workspace;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import org.junit.Assume;
import org.junit.Test;

public class WorkspacePathPolicyTest {
    @Test public void resolvesOnlyRelativeChildren() throws Exception {
        File root = new File(System.getProperty("java.io.tmpdir"), "yachiyo-workspace-policy");
        assertEquals(new File(root, "src/index.ts").getCanonicalFile(), WorkspacePathPolicy.resolve(root, "src/index.ts"));
    }

    @Test public void rejectsTraversalAndAbsolutePaths() {
        File root = new File(System.getProperty("java.io.tmpdir"), "yachiyo-workspace-policy");
        assertThrows(IOException.class, () -> WorkspacePathPolicy.resolve(root, "../secret"));
        assertThrows(IOException.class, () -> WorkspacePathPolicy.resolve(root, "/data/local/tmp"));
        assertThrows(IOException.class, () -> WorkspacePathPolicy.resolve(root, "C:/secret"));
    }

    @Test public void rejectsSymlinksEvenWhenTheyPointInsideTheRoot() throws Exception {
        File root = Files.createTempDirectory("yachiyo-workspace-policy").toFile();
        File real = new File(root, "real");
        if (!real.mkdirs()) throw new IOException("test_directory_unavailable");
        File link = new File(root, "linked");
        try {
            Files.createSymbolicLink(link.toPath(), real.toPath());
        } catch (UnsupportedOperationException | IOException | SecurityException error) {
            Assume.assumeNoException(error);
        }
        assertThrows(IOException.class, () -> WorkspacePathPolicy.resolve(root, "linked/file.txt"));
    }
}
