package io.github.yachiyoclaw.sandbox;

import android.content.Context;
import java.io.File;
import java.util.ArrayList;
import java.util.List;

/** Builds the fixed PRoot boundary; callers only supply a validated command and workspace. */
final class SandboxProcessFactory {
    record RuntimeConfig(String id, String shell, String path, String home) {
        static RuntimeConfig alpine() {
            return new RuntimeConfig(
                "alpine",
                "/bin/sh",
                "/opt/android-sdk/cmdline-tools/latest/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/opt/android-sdk/platform-tools",
                "/root"
            );
        }

        static RuntimeConfig ubuntu() {
            return new RuntimeConfig("ubuntu-24.04", "/bin/bash", "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "/root");
        }
    }

    private SandboxProcessFactory() {}

    static ProcessBuilder create(Context context, File rootfs, File runtimeDirectory, File workspace, String command) throws Exception {
        return create(context, rootfs, runtimeDirectory, workspace, command, RuntimeConfig.alpine());
    }

    static ProcessBuilder create(
        Context context,
        File rootfs,
        File runtimeDirectory,
        File workspace,
        String command,
        RuntimeConfig config
    ) throws Exception {
        File nativeDirectory = new File(context.getApplicationInfo().nativeLibraryDir);
        File proot = new File(nativeDirectory, "libyachiyo_proot.so");
        File loader = new File(nativeDirectory, "libyachiyo_proot_loader.so");
        if (!proot.isFile() || !loader.isFile()) throw new IllegalStateException("sandbox_native_runtime_missing");
        File temp = new File(context.getCacheDir(), "proot-tmp");
        if (!temp.isDirectory() && !temp.mkdirs()) throw new IllegalStateException("sandbox_temp_unavailable");

        List<String> arguments = new ArrayList<>();
        arguments.add(proot.getAbsolutePath());
        arguments.add("--link2symlink");
        arguments.add("-0");
        arguments.add("-r");
        arguments.add(rootfs.getAbsolutePath());
        arguments.add("-b");
        arguments.add("/dev");
        arguments.add("-b");
        arguments.add("/proc");
        arguments.add("-b");
        arguments.add(workspace.getAbsolutePath() + ":/workspace");
        arguments.add("-w");
        arguments.add("/workspace");
        arguments.add("/usr/bin/env");
        arguments.add("-i");
        arguments.add("HOME=" + config.home());
        arguments.add("PATH=" + config.path());
        arguments.add("ANDROID_HOME=/opt/android-sdk");
        arguments.add("ANDROID_SDK_ROOT=/opt/android-sdk");
        arguments.add("TERM=xterm-256color");
        arguments.add("LANG=C.UTF-8");
        arguments.add(config.shell());
        arguments.add("-lc");
        arguments.add(command);

        ProcessBuilder builder = new ProcessBuilder(arguments);
        builder.directory(workspace);
        builder.environment().put("PROOT_LOADER", loader.getAbsolutePath());
        builder.environment().put("PROOT_TMP_DIR", temp.getAbsolutePath());
        builder.environment().put("PROOT_NO_SECCOMP", "1");
        builder.environment().put("LD_LIBRARY_PATH", runtimeDirectory.getAbsolutePath() + ":" + nativeDirectory.getAbsolutePath());
        return builder;
    }
}
