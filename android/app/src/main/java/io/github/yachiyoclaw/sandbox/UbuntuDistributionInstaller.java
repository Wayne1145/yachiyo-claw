package io.github.yachiyoclaw.sandbox;

import android.content.Context;
import android.os.StatFs;
import io.github.yachiyoclaw.download.GenericDownloadCoordinator;
import io.github.yachiyoclaw.download.YachiyoDownloadSettingsPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import org.json.JSONObject;

/** Installs a pinned Ubuntu rootfs atomically and keeps its lifecycle separate from bundled Alpine. */
final class UbuntuDistributionInstaller {
    static final long REQUIRED_FREE_BYTES = 2L * 1024L * 1024L * 1024L;

    private final Context context;
    private final UbuntuDistribution.Spec distribution;
    private final AlpineSandboxInstaller alpineRuntime;
    private final File distributionDirectory;
    private final File rootfsDirectory;
    private final File readyMarker;

    UbuntuDistributionInstaller(Context context, UbuntuDistribution.Spec distribution) {
        this.context = context.getApplicationContext();
        this.distribution = distribution;
        SandboxDistribution.Spec alpine = SandboxDistribution.forAbi(distribution.androidAbi());
        if (alpine == null) throw new IllegalArgumentException("sandbox_abi_unsupported");
        this.alpineRuntime = new AlpineSandboxInstaller(context, alpine);
        this.distributionDirectory = new File(context.getFilesDir(), "linux-distributions/ubuntu-24.04");
        this.rootfsDirectory = new File(distributionDirectory, "rootfs-" + distribution.archiveArch());
        this.readyMarker = new File(rootfsDirectory, ".yachiyo-rootfs-" + UbuntuDistribution.VERSION);
    }

    File rootfsDirectory() { return rootfsDirectory; }
    File runtimeDirectory() { return alpineRuntime.runtimeDirectory(); }
    File toolchainMarker() { return new File(rootfsDirectory, ".yachiyo-toolchain-v1"); }
    UbuntuDistribution.Spec spec() { return distribution; }

    boolean isInstalled() {
        return readyMarker.isFile() && new File(rootfsDirectory, "bin/bash").isFile();
    }

    boolean isReady() { return isInstalled() && toolchainMarker().isFile(); }

    String downloadState() {
        JSONObject task = GenericDownloadCoordinator.task(context, distribution.downloadId());
        return task == null ? "not_downloaded" : task.optString("status", "not_downloaded");
    }

    JSONObject downloadTask() { return GenericDownloadCoordinator.task(context, distribution.downloadId()); }

    void enqueueDownload() throws Exception {
        if (isInstalled()) return;
        if (new StatFs(context.getFilesDir().getAbsolutePath()).getAvailableBytes() < REQUIRED_FREE_BYTES) {
            throw new IOException("ubuntu_storage_low");
        }
        GenericDownloadCoordinator.enqueue(
            context,
            distribution.downloadId(),
            "linux-runtime",
            "Ubuntu 24.04 开发环境",
            YachiyoDownloadSettingsPlugin.mirrorUbuntuImageUrl(context, distribution.url()),
            distribution.url(),
            distribution.size(),
            distribution.sha256()
        );
    }

    void installDownloaded(AlpineSandboxInstaller.ProgressListener listener) throws Exception {
        if (isInstalled()) {
            listener.onProgress("rootfs_ready", 100, 1, 1);
            return;
        }
        alpineRuntime.prepareRuntimeFiles();
        File archive = GenericDownloadCoordinator.requireCompletedArtifact(context, distribution.downloadId(), distribution.size());
        verifyArchive(archive);
        if (!distributionDirectory.isDirectory() && !distributionDirectory.mkdirs()) {
            throw new IOException("ubuntu_storage_unavailable");
        }
        File staging = new File(distributionDirectory, "rootfs.installing-" + distribution.archiveArch());
        AlpineSandboxInstaller.deleteRecursively(staging);
        if (!staging.mkdirs()) throw new IOException("ubuntu_staging_unavailable");
        try {
            listener.onProgress("extracting", 0, 0, distribution.size());
            AlpineSandboxInstaller.extractArchive(archive, staging, UbuntuDistribution.MAX_EXTRACTED_BYTES, listener);
            configureRootfs(staging);
            File marker = new File(staging, readyMarker.getName());
            if (!marker.createNewFile()) throw new IOException("ubuntu_marker_failed");
            File previous = new File(distributionDirectory, "rootfs.previous-" + distribution.archiveArch());
            AlpineSandboxInstaller.deleteRecursively(previous);
            if (rootfsDirectory.exists()) Files.move(rootfsDirectory.toPath(), previous.toPath(), StandardCopyOption.REPLACE_EXISTING);
            try {
                Files.move(staging.toPath(), rootfsDirectory.toPath(), StandardCopyOption.REPLACE_EXISTING);
                AlpineSandboxInstaller.deleteRecursively(previous);
            } catch (Exception error) {
                if (previous.exists() && !rootfsDirectory.exists()) {
                    Files.move(previous.toPath(), rootfsDirectory.toPath(), StandardCopyOption.REPLACE_EXISTING);
                }
                throw error;
            }
            GenericDownloadCoordinator.discard(context, distribution.downloadId());
            listener.onProgress("rootfs_ready", 100, distribution.size(), distribution.size());
        } catch (Exception error) {
            AlpineSandboxInstaller.deleteRecursively(staging);
            throw error;
        }
    }

    void remove() throws Exception {
        AlpineSandboxInstaller.deleteRecursively(rootfsDirectory);
        GenericDownloadCoordinator.discard(context, distribution.downloadId());
    }

    private void configureRootfs(File rootfs) throws Exception {
        write(rootfs, "etc/resolv.conf", "nameserver 1.1.1.1\nnameserver 8.8.8.8\n");
        boolean mirror = YachiyoDownloadSettingsPlugin.linuxMirror(context);
        String origin = distribution.dpkgArch().equals("arm64")
            ? (mirror ? "https://mirrors.tuna.tsinghua.edu.cn/ubuntu-ports" : "http://ports.ubuntu.com/ubuntu-ports")
            : (mirror ? "https://mirrors.tuna.tsinghua.edu.cn/ubuntu" : "http://archive.ubuntu.com/ubuntu");
        String sources = "Types: deb\nURIs: " + origin + "\nSuites: noble noble-updates noble-security\n" +
            "Components: main universe multiverse restricted\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n";
        write(rootfs, "etc/apt/sources.list.d/ubuntu.sources", sources);
    }

    private static void write(File rootfs, String path, String content) throws Exception {
        File target = new File(rootfs, path).getCanonicalFile();
        File canonicalRoot = rootfs.getCanonicalFile();
        if (!target.toPath().startsWith(canonicalRoot.toPath())) throw new IOException("ubuntu_path_escape");
        File parent = target.getParentFile();
        if (parent == null || (!parent.isDirectory() && !parent.mkdirs())) throw new IOException("ubuntu_config_parent_failed");
        try (FileOutputStream output = new FileOutputStream(target)) {
            output.write(content.getBytes(StandardCharsets.UTF_8));
            output.getFD().sync();
        }
    }

    private void verifyArchive(File archive) throws Exception {
        if (archive.length() != distribution.size()) throw new IOException("ubuntu_archive_size_mismatch");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (java.io.InputStream input = Files.newInputStream(archive.toPath())) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) >= 0) digest.update(buffer, 0, read);
        }
        if (!hex(digest.digest()).equalsIgnoreCase(distribution.sha256())) throw new IOException("ubuntu_archive_digest_mismatch");
    }

    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) result.append(String.format("%02x", value));
        return result.toString();
    }
}
