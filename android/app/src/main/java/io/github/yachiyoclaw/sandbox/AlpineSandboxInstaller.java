package io.github.yachiyoclaw.sandbox;

import android.content.Context;
import android.system.Os;
import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import org.apache.commons.compress.archivers.tar.TarArchiveEntry;
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream;
import org.apache.commons.compress.compressors.gzip.GzipCompressorInputStream;

final class AlpineSandboxInstaller {
    interface ProgressListener {
        void onProgress(String stage, int percent, long transferred, long total);
    }

    private record PendingLink(File path, String target, boolean hardLink) {}

    private final Context context;
    private final SandboxDistribution.Spec distribution;
    private final File sandboxDirectory;
    private final File rootfsDirectory;
    private final File runtimeDirectory;
    private final File readyMarker;

    AlpineSandboxInstaller(Context context, SandboxDistribution.Spec distribution) {
        this.context = context;
        this.distribution = distribution;
        this.sandboxDirectory = new File(context.getFilesDir(), "linux-sandbox");
        this.rootfsDirectory = new File(sandboxDirectory, "rootfs-" + distribution.alpineArch());
        this.runtimeDirectory = new File(context.getCodeCacheDir(), "yachiyo-sandbox/" + SandboxDistribution.VERSION + "/" + distribution.androidAbi());
        this.readyMarker = new File(rootfsDirectory, ".yachiyo-rootfs-" + SandboxDistribution.VERSION + "-" + distribution.alpineArch());
    }

    File rootfsDirectory() {
        return rootfsDirectory;
    }

    File runtimeDirectory() {
        return runtimeDirectory;
    }

    boolean isInstalled() {
        return readyMarker.isFile() && Files.exists(new File(rootfsDirectory, "bin/sh").toPath(), LinkOption.NOFOLLOW_LINKS);
    }

    void install(ProgressListener listener) throws Exception {
        prepareRuntimeFiles();
        if (isInstalled()) {
            listener.onProgress("rootfs_ready", 100, 1, 1);
            return;
        }
        if (!sandboxDirectory.exists() && !sandboxDirectory.mkdirs()) throw new IOException("sandbox_storage_unavailable");
        File archive = new File(sandboxDirectory, "bundled-" + distribution.alpineArch() + ".tar.gz");
        File staging = new File(sandboxDirectory, "rootfs.installing");
        deleteRecursively(staging);
        if (!staging.mkdirs()) throw new IOException("sandbox_staging_unavailable");
        try {
            copyBundledArchive(archive, listener);
            listener.onProgress("extracting", 0, 0, 0);
            extract(archive, staging, listener);
            File marker = new File(staging, readyMarker.getName());
            if (!marker.createNewFile()) throw new IOException("sandbox_marker_failed");
            deleteRecursively(rootfsDirectory);
            Files.move(staging.toPath(), rootfsDirectory.toPath(), StandardCopyOption.REPLACE_EXISTING);
            listener.onProgress("rootfs_ready", 100, 1, 1);
        } catch (Exception error) {
            deleteRecursively(staging);
            throw error;
        }
        Files.deleteIfExists(archive.toPath());
    }

    private void copyBundledArchive(File archive, ProgressListener listener) throws Exception {
        File partial = new File(archive.getAbsolutePath() + ".partial");
        Files.deleteIfExists(partial.toPath());
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long copied = 0;
        try (InputStream input = new BufferedInputStream(context.getAssets().open(distribution.assetPath()));
             FileOutputStream fileOutput = new FileOutputStream(partial);
             BufferedOutputStream output = new BufferedOutputStream(fileOutput)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) >= 0) {
                copied += read;
                if (copied > SandboxDistribution.MAX_ARCHIVE_BYTES) throw new IOException("sandbox_archive_too_large");
                digest.update(buffer, 0, read);
                output.write(buffer, 0, read);
                listener.onProgress("copying_bundled_rootfs", (int) Math.min(99, copied * 100 / distribution.size()), copied, distribution.size());
            }
            output.flush();
            fileOutput.getFD().sync();
        } catch (Exception error) {
            Files.deleteIfExists(partial.toPath());
            throw error;
        }
        if (copied != distribution.size() || !hex(digest.digest()).equalsIgnoreCase(distribution.sha256())) {
            Files.deleteIfExists(partial.toPath());
            throw new IOException("sandbox_bundled_archive_integrity_failed");
        }
        Files.move(partial.toPath(), archive.toPath(), StandardCopyOption.REPLACE_EXISTING);
        listener.onProgress("copying_bundled_rootfs", 100, copied, distribution.size());
    }

    void prepareRuntimeFiles() throws Exception {
        if (!runtimeDirectory.exists() && !runtimeDirectory.mkdirs()) throw new IOException("sandbox_runtime_unavailable");
        File talloc = new File(runtimeDirectory, "libtalloc.so.2");
        if (!talloc.isFile()) {
            try (InputStream input = context.getAssets().open("sandbox/" + distribution.androidAbi() + "/libtalloc.so.2")) {
                File temporary = new File(runtimeDirectory, "libtalloc.so.2.partial");
                try (FileOutputStream output = new FileOutputStream(temporary)) {
                    byte[] buffer = new byte[16 * 1024];
                    int read;
                    while ((read = input.read(buffer)) >= 0) output.write(buffer, 0, read);
                    output.getFD().sync();
                }
                Files.move(temporary.toPath(), talloc.toPath(), StandardCopyOption.REPLACE_EXISTING);
            }
        }
        Os.chmod(runtimeDirectory.getAbsolutePath(), 0500);
        Os.chmod(talloc.getAbsolutePath(), 0400);
    }

    private void extract(File archive, File destination, ProgressListener listener) throws Exception {
        extractArchive(archive, destination, SandboxDistribution.MAX_EXTRACTED_BYTES, listener);
    }

    /** Shared hardened tar.gz extractor for trusted, digest-pinned Linux distributions. */
    static void extractArchive(File archive, File destination, long maximumExtractedBytes, ProgressListener listener)
        throws Exception {
        List<PendingLink> links = new ArrayList<>();
        long extracted = 0;
        int entries = 0;
        try (TarArchiveInputStream tar = new TarArchiveInputStream(
            new GzipCompressorInputStream(new BufferedInputStream(new FileInputStream(archive))))) {
            TarArchiveEntry entry;
            while ((entry = tar.getNextTarEntry()) != null) {
                if (++entries > 100_000) throw new IOException("sandbox_archive_entry_limit");
                String name = normalizeArchivePath(entry.getName());
                if (name.isEmpty()) continue;
                File target = resolveArchiveTarget(destination, name);
                if (entry.isDirectory()) {
                    if (!target.isDirectory() && !target.mkdirs()) throw new IOException("sandbox_extract_directory_failed");
                    chmod(target, entry.getMode());
                    continue;
                }
                File parent = target.getParentFile();
                if (parent == null || (!parent.isDirectory() && !parent.mkdirs())) throw new IOException("sandbox_extract_parent_failed");
                if (entry.isSymbolicLink() || entry.isLink()) {
                    links.add(new PendingLink(target, entry.getLinkName(), entry.isLink()));
                    continue;
                }
                if (!entry.isFile()) continue;
                extracted = Math.addExact(extracted, entry.getSize());
                if (extracted > maximumExtractedBytes) throw new IOException("sandbox_rootfs_too_large");
                try (FileOutputStream output = new FileOutputStream(target)) {
                    byte[] buffer = new byte[64 * 1024];
                    long remaining = entry.getSize();
                    while (remaining > 0) {
                        int read = tar.read(buffer, 0, (int) Math.min(buffer.length, remaining));
                        if (read < 0) throw new IOException("sandbox_archive_truncated");
                        output.write(buffer, 0, read);
                        remaining -= read;
                    }
                    output.getFD().sync();
                }
                chmod(target, entry.getMode());
                if ((entries & 127) == 0) listener.onProgress("extracting", Math.min(99, entries / 10), extracted, 0);
            }
        }
        for (PendingLink link : links) {
            Files.deleteIfExists(link.path().toPath());
            if (link.hardLink()) {
                File source = resolveArchiveTarget(destination, normalizeArchivePath(link.target()));
                Files.createLink(link.path().toPath(), source.toPath());
            } else {
                validateSymlinkTarget(destination, link.path(), link.target());
                Files.createSymbolicLink(link.path().toPath(), new File(link.target()).toPath());
            }
        }
    }

    static String normalizeArchivePath(String value) {
        if (value == null || value.indexOf('\0') >= 0 || value.indexOf('\\') >= 0) throw new IllegalArgumentException("sandbox_archive_path_invalid");
        String normalized = value;
        while (normalized.startsWith("./")) normalized = normalized.substring(2);
        if (normalized.startsWith("/") || normalized.equals("..") || normalized.startsWith("../") || normalized.contains("/../")) {
            throw new IllegalArgumentException("sandbox_archive_path_escape");
        }
        return normalized;
    }

    private static File resolveArchiveTarget(File destination, String name) throws Exception {
        File root = destination.getCanonicalFile();
        File target = new File(root, name).getCanonicalFile();
        if (!target.equals(root) && !target.getPath().startsWith(root.getPath() + File.separator)) {
            throw new IllegalArgumentException("sandbox_archive_path_escape");
        }
        return target;
    }

    private static void validateSymlinkTarget(File destination, File link, String target) throws Exception {
        if (target == null || target.trim().isEmpty() || target.indexOf('\0') >= 0 || target.indexOf('\\') >= 0) {
            throw new IllegalArgumentException("sandbox_archive_link_invalid");
        }
        // Absolute links are guest-root paths interpreted by PRoot. Relative links may
        // contain '..', but their normalized destination must remain in the guest tree.
        if (!target.startsWith("/")) {
            File root = destination.getCanonicalFile();
            File resolved = new File(link.getParentFile(), target).getCanonicalFile();
            if (!resolved.equals(root) && !resolved.getPath().startsWith(root.getPath() + File.separator)) {
                throw new IllegalArgumentException("sandbox_archive_link_escape");
            }
        }
    }

    private static void chmod(File file, int archiveMode) {
        try {
            Os.chmod(file.getAbsolutePath(), archiveMode & 0777);
        } catch (Exception ignored) {
            file.setReadable(true, true);
            if ((archiveMode & 0111) != 0) file.setExecutable(true, true);
        }
    }

    static void deleteRecursively(File target) throws IOException {
        if (!target.exists()) return;
        if (target.isDirectory() && !Files.isSymbolicLink(target.toPath())) {
            File[] children = target.listFiles();
            if (children != null) for (File child : children) deleteRecursively(child);
        }
        if (!target.delete() && target.exists()) throw new IOException("sandbox_delete_failed");
    }

    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) result.append(String.format("%02x", value));
        return result.toString();
    }
}
