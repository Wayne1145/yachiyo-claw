package io.github.yachiyoclaw.sandbox;

import static org.junit.Assert.*;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import org.junit.Assume;
import org.junit.Test;

public final class SandboxStagingCleanupTest {
    @Test public void removesDanglingGuestLinksWithoutFollowingExternalTargets() throws Exception {
        Path root = Files.createTempDirectory("sandbox-cleanup-");
        Path outside = Files.createTempDirectory("sandbox-outside-");
        Path keep = Files.write(outside.resolve("keep"), "untouched".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        try {
            try {
                Files.createSymbolicLink(root.resolve("dangling"), root.resolve("absent"));
                Files.createSymbolicLink(root.resolve("outside"), outside);
            } catch (UnsupportedOperationException | java.nio.file.FileSystemException error) {
                Assume.assumeNoException("Host does not permit symbolic links", error);
            }
            AlpineSandboxInstaller.deleteRecursively(root.toFile());
            assertFalse(Files.exists(root, LinkOption.NOFOLLOW_LINKS));
            assertEquals("untouched", new String(Files.readAllBytes(keep), java.nio.charset.StandardCharsets.UTF_8));
        } finally {
            Files.deleteIfExists(root.resolve("dangling"));
            Files.deleteIfExists(root.resolve("outside"));
            Files.deleteIfExists(root);
            Files.deleteIfExists(keep);
            Files.deleteIfExists(outside);
        }
    }
}
