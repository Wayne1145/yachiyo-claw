package io.github.yachiyoclaw.artifact;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;
import java.io.File;
import java.nio.file.Files;
import org.junit.Test;

public class ArtifactPathPolicyTest {
    @Test public void resolvesOnlyInsideHashedWorkspace() throws Exception {
        File files = Files.createTempDirectory("artifact-policy").toFile();
        File workspace = ArtifactPathPolicy.workspace(files, "coding:project");
        assertEquals(new File(workspace, "app/build/app.apk").getCanonicalFile(), ArtifactPathPolicy.resolve(workspace, "app/build/app.apk"));
        assertThrows(Exception.class, () -> ArtifactPathPolicy.resolve(workspace, "../outside.apk"));
        assertThrows(Exception.class, () -> ArtifactPathPolicy.resolve(workspace, "/outside.apk"));
    }
}
