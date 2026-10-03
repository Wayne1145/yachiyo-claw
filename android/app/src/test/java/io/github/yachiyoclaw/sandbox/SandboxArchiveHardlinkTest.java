package io.github.yachiyoclaw.sandbox;

import static org.junit.Assert.*;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.apache.commons.compress.archivers.tar.TarArchiveEntry;
import org.apache.commons.compress.archivers.tar.TarArchiveOutputStream;
import org.apache.commons.compress.archivers.tar.TarConstants;
import org.apache.commons.compress.compressors.gzip.GzipCompressorOutputStream;
import org.junit.Test;

public final class SandboxArchiveHardlinkTest {
    private Path fixture(Path root) throws Exception {
        Path archive = root.resolve("rootfs.tgz");
        try (TarArchiveOutputStream tar = new TarArchiveOutputStream(
                new GzipCompressorOutputStream(Files.newOutputStream(archive)))) {
            TarArchiveEntry file = new TarArchiveEntry("bin/original");
            file.setSize(5);
            file.setMode(0755);
            tar.putArchiveEntry(file);
            tar.write(new byte[] {1, 2, 3, 4, 5});
            tar.closeArchiveEntry();
            TarArchiveEntry link = new TarArchiveEntry("bin/alias", TarConstants.LF_LINK);
            link.setLinkName("bin/original");
            link.setMode(0755);
            tar.putArchiveEntry(link);
            tar.closeArchiveEntry();
        }
        return archive;
    }

    @Test public void extractsGuestHardlinksWithoutRequiringHostLinkSupport() throws Exception {
        Path root = Files.createTempDirectory("rootfs-hardlink-");
        try {
            Path archive = fixture(root);
            Path destination = Files.createDirectory(root.resolve("unpacked"));
            AlpineSandboxInstaller.extractArchive(archive.toFile(), destination.toFile(), 10, (s, p, b, n) -> {});
            assertArrayEquals(Files.readAllBytes(destination.resolve("bin/original")),
                Files.readAllBytes(destination.resolve("bin/alias")));
            assertFalse(Files.isSameFile(destination.resolve("bin/original"), destination.resolve("bin/alias")));
        } finally {
            AlpineSandboxInstaller.deleteRecursively(root.toFile());
        }
    }

    @Test public void countsMaterializedHardlinkBytesAgainstTheArchiveLimit() throws Exception {
        Path root = Files.createTempDirectory("rootfs-budget-");
        try {
            Path archive = fixture(root);
            Path destination = Files.createDirectory(root.resolve("unpacked"));
            try {
                AlpineSandboxInstaller.extractArchive(archive.toFile(), destination.toFile(), 9, (s, p, b, n) -> {});
                fail("The alias must count towards the byte limit");
            } catch (IOException error) {
                assertEquals("sandbox_rootfs_too_large", error.getMessage());
            }
        } finally {
            AlpineSandboxInstaller.deleteRecursively(root.toFile());
        }
    }
}
