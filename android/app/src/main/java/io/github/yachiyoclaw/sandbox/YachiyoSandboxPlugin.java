package io.github.yachiyoclaw.sandbox;

import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.os.StatFs;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

@CapacitorPlugin(name = "YachiyoSandbox")
public final class YachiyoSandboxPlugin extends Plugin {
    private static final long REQUIRED_FREE_BYTES = 768L * 1024L * 1024L;
    private static final long MAX_FILE_BYTES = 4L * 1024L * 1024L;
    private static final int MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
    private static final int MAX_WALK_ENTRIES = 20_000;
    private static final String TOOLCHAIN_PACKAGES =
        "bash git python3 py3-pip nodejs npm openssh-client curl ca-certificates build-base";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean installRunning = new AtomicBoolean(false);
    private final AtomicReference<Process> activeProcess = new AtomicReference<>();
    private volatile AlpineSandboxInstaller installer;
    private volatile File workspace;
    private volatile String state = "not_installed";
    private volatile String lastError;

    @Override
    public void load() {
        SandboxDistribution.Spec distribution = SandboxDistribution.current(getContext().getApplicationInfo().nativeLibraryDir);
        if (distribution == null) {
            state = "unsupported";
            return;
        }
        installer = new AlpineSandboxInstaller(getContext(), distribution);
        workspace = new File(getContext().getFilesDir(), "linux-sandbox/workspaces/default");
        state = installer.isInstalled() ? (toolchainMarker().isFile() ? "ready" : "rootfs_ready") : "not_installed";
    }

    @PluginMethod
    public void checkAvailability(PluginCall call) {
        SandboxDistribution.Spec distribution = SandboxDistribution.current(getContext().getApplicationInfo().nativeLibraryDir);
        StatFs storage = new StatFs(getContext().getFilesDir().getAbsolutePath());
        boolean supported = distribution != null;
        boolean enoughStorage = storage.getAvailableBytes() >= REQUIRED_FREE_BYTES || (installer != null && installer.isInstalled());
        JSObject result = new JSObject();
        result.put("available", supported && enoughStorage);
        if (!supported) result.put("reason", "sandbox_abi_unsupported");
        else if (!enoughStorage) result.put("reason", "sandbox_storage_low");
        result.put("installed", installer != null && installer.isInstalled());
        result.put("state", state);
        call.resolve(result);
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("state", state);
        result.put("installed", installer != null && installer.isInstalled());
        result.put("toolchainReady", toolchainMarker().isFile());
        result.put("workingDirectory", workspace == null ? null : workspace.getAbsolutePath());
        result.put("platform", "android-proot-alpine");
        result.put("distribution", SandboxDistribution.VERSION);
        if (lastError != null) result.put("error", lastError);
        call.resolve(result);
    }

    @PluginMethod
    public void install(PluginCall call) {
        if (installer == null) {
            call.reject("sandbox_abi_unsupported");
            return;
        }
        if (!installRunning.compareAndSet(false, true)) {
            call.reject("sandbox_install_in_progress");
            return;
        }
        executor.execute(() -> {
            try {
                ensureInstalled();
                call.resolve(statusObject());
            } catch (Exception error) {
                lastError = safeError(error, "sandbox_install_failed");
                state = "error";
                call.reject(lastError);
            } finally {
                installRunning.set(false);
            }
        });
    }

    @PluginMethod
    public void init(PluginCall call) {
        if (installer == null) {
            call.reject("sandbox_abi_unsupported");
            return;
        }
        String requested = call.getString("workingDirectory", "default");
        executor.execute(() -> {
            try {
                ensureInstalled();
                workspace = workspaceFor(requested);
                if (!workspace.isDirectory() && !workspace.mkdirs()) throw new IOException("sandbox_workspace_unavailable");
                call.resolve(new JSObject().put("success", true).put("workingDirectory", workspace.getAbsolutePath()));
            } catch (Exception error) {
                call.resolve(new JSObject().put("success", false).put("error", safeError(error, "sandbox_init_failed")));
            }
        });
    }

    @PluginMethod
    public void exec(PluginCall call) {
        String command = call.getString("command", "").trim();
        int timeout = Math.max(1_000, Math.min(call.getInt("timeout", 120_000), 900_000));
        if (command.isEmpty() || command.length() > 64 * 1024 || command.indexOf('\0') >= 0) {
            call.reject("sandbox_command_invalid");
            return;
        }
        executor.execute(() -> {
            try {
                requireReady();
                CommandResult result = runGuestCommand(command, timeout);
                call.resolve(commandResult(result));
            } catch (Exception error) {
                call.resolve(new JSObject().put("stdout", "").put("stderr", safeError(error, "sandbox_exec_failed")).put("exitCode", 1));
            }
        });
    }

    @PluginMethod
    public void kill(PluginCall call) {
        Process process = activeProcess.getAndSet(null);
        if (process != null) {
            process.destroy();
            process.destroyForcibly();
        }
        call.resolve(new JSObject().put("killed", process != null));
    }

    @PluginMethod
    public void read(PluginCall call) {
        try {
            File target = resolveWorkspace(call.getString("filePath", ""));
            if (!target.isFile() || Files.isSymbolicLink(target.toPath())) throw new IOException("sandbox_file_not_found");
            if (target.length() > MAX_FILE_BYTES) throw new IOException("sandbox_file_too_large");
            String content = new String(Files.readAllBytes(target.toPath()), StandardCharsets.UTF_8);
            call.resolve(new JSObject().put("success", true).put("content", content));
        } catch (Exception error) {
            call.resolve(fileError(error, "sandbox_read_failed"));
        }
    }

    @PluginMethod
    public void write(PluginCall call) {
        try {
            File target = resolveWorkspace(call.getString("filePath", ""));
            String content = call.getString("content", "");
            byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
            if (bytes.length > MAX_FILE_BYTES) throw new IOException("sandbox_file_too_large");
            File parent = target.getParentFile();
            if (parent == null || (!parent.isDirectory() && !parent.mkdirs())) throw new IOException("sandbox_parent_unavailable");
            File temporary = new File(parent, target.getName() + ".yachiyo.tmp");
            try (FileOutputStream output = new FileOutputStream(temporary)) {
                output.write(bytes);
                output.getFD().sync();
            }
            Files.move(temporary.toPath(), target.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            call.resolve(new JSObject().put("success", true));
        } catch (Exception error) {
            call.resolve(fileError(error, "sandbox_write_failed"));
        }
    }

    @PluginMethod
    public void edit(PluginCall call) {
        try {
            File target = resolveWorkspace(call.getString("filePath", ""));
            if (!target.isFile() || target.length() > MAX_FILE_BYTES) throw new IOException("sandbox_file_unavailable");
            String search = call.getString("search", "");
            String replacement = call.getString("replace", "");
            if (search.isEmpty()) throw new IOException("sandbox_edit_search_empty");
            String content = new String(Files.readAllBytes(target.toPath()), StandardCharsets.UTF_8);
            int first = content.indexOf(search);
            if (first < 0) throw new IOException("sandbox_edit_match_missing");
            if (content.indexOf(search, first + search.length()) >= 0) throw new IOException("sandbox_edit_match_not_unique");
            String updated = content.substring(0, first) + replacement + content.substring(first + search.length());
            if (updated.getBytes(StandardCharsets.UTF_8).length > MAX_FILE_BYTES) throw new IOException("sandbox_file_too_large");
            Files.write(target.toPath(), updated.getBytes(StandardCharsets.UTF_8));
            call.resolve(new JSObject().put("success", true));
        } catch (Exception error) {
            call.resolve(fileError(error, "sandbox_edit_failed"));
        }
    }

    @PluginMethod
    public void list(PluginCall call) {
        try {
            File directory = resolveWorkspace(call.getString("dirPath", "."));
            if (!directory.isDirectory()) throw new IOException("sandbox_directory_not_found");
            StringBuilder output = new StringBuilder();
            File[] children = directory.listFiles();
            if (children != null) {
                java.util.Arrays.sort(children, (left, right) -> left.getName().compareToIgnoreCase(right.getName()));
                for (File child : children) {
                    if (output.length() >= MAX_OUTPUT_BYTES) break;
                    output.append(child.isDirectory() ? "d" : "-")
                        .append('\t').append(child.length()).append('\t').append(child.getName()).append('\n');
                }
            }
            call.resolve(new JSObject().put("success", true).put("content", output.toString()));
        } catch (Exception error) {
            call.resolve(fileError(error, "sandbox_list_failed"));
        }
    }

    @PluginMethod
    public void grep(PluginCall call) {
        try {
            String patternText = call.getString("pattern", "");
            if (patternText.length() > 4_096) throw new IOException("sandbox_pattern_too_large");
            Pattern pattern = Pattern.compile(patternText);
            String include = call.getString("include");
            Pattern includePattern = include == null || include.trim().isEmpty() ? null : globPattern(include);
            File directory = resolveWorkspace(call.getString("dirPath", "."));
            StringBuilder output = new StringBuilder();
            walkFiles(directory, (file, relative) -> {
                if (includePattern != null && !includePattern.matcher(file.getName()).matches()) return;
                if (file.length() > MAX_FILE_BYTES) return;
                List<String> lines = Files.readAllLines(file.toPath(), StandardCharsets.UTF_8);
                for (int index = 0; index < lines.size() && output.length() < MAX_OUTPUT_BYTES; index++) {
                    if (pattern.matcher(lines.get(index)).find()) output.append(relative).append(':').append(index + 1).append(':').append(lines.get(index)).append('\n');
                }
            });
            call.resolve(new JSObject().put("success", true).put("content", output.toString()));
        } catch (PatternSyntaxException error) {
            call.resolve(fileError(new IOException("sandbox_pattern_invalid"), "sandbox_grep_failed"));
        } catch (Exception error) {
            call.resolve(fileError(error, "sandbox_grep_failed"));
        }
    }

    @PluginMethod
    public void find(PluginCall call) {
        try {
            Pattern pattern = globPattern(call.getString("pattern", "*"));
            File directory = resolveWorkspace(call.getString("dirPath", "."));
            StringBuilder output = new StringBuilder();
            walkFiles(directory, (file, relative) -> {
                if (pattern.matcher(file.getName()).matches() && output.length() < MAX_OUTPUT_BYTES) output.append(relative).append('\n');
            });
            call.resolve(new JSObject().put("success", true).put("content", output.toString()));
        } catch (Exception error) {
            call.resolve(fileError(error, "sandbox_find_failed"));
        }
    }

    @PluginMethod
    public void reset(PluginCall call) {
        killProcess();
        executor.execute(() -> {
            try {
                AlpineSandboxInstaller.deleteRecursively(installer.rootfsDirectory());
                Files.deleteIfExists(toolchainMarker().toPath());
                state = "not_installed";
                lastError = null;
                call.resolve(new JSObject().put("success", true));
            } catch (Exception error) {
                call.resolve(new JSObject().put("success", false).put("error", safeError(error, "sandbox_reset_failed")));
            }
        });
    }

    private void ensureInstalled() throws Exception {
        state = "installing";
        lastError = null;
        installer.install(this::emitProgress);
        if (!toolchainMarker().isFile()) {
            state = "installing_toolchain";
            emitProgress("installing_toolchain", 0, 0, 0);
            File defaultWorkspace = workspaceFor("default");
            if (!defaultWorkspace.isDirectory() && !defaultWorkspace.mkdirs()) throw new IOException("sandbox_workspace_unavailable");
            workspace = defaultWorkspace;
            CommandResult packages = runGuestCommand(
                "apk update && apk add --no-cache " + TOOLCHAIN_PACKAGES + " && python3 --version && node --version && git --version",
                900_000
            );
            if (packages.exitCode != 0) throw new IOException("sandbox_toolchain_install_failed");
            if (!toolchainMarker().createNewFile()) throw new IOException("sandbox_toolchain_marker_failed");
        }
        state = "ready";
        emitProgress("ready", 100, 1, 1);
    }

    private CommandResult runGuestCommand(String command, int timeoutMs) throws Exception {
        if (!installer.isInstalled()) throw new IOException("sandbox_not_installed");
        if (workspace == null) workspace = workspaceFor("default");
        if (!workspace.isDirectory() && !workspace.mkdirs()) throw new IOException("sandbox_workspace_unavailable");
        syncGuestDns();
        File nativeDirectory = new File(getContext().getApplicationInfo().nativeLibraryDir);
        File proot = new File(nativeDirectory, "libyachiyo_proot.so");
        File loader = new File(nativeDirectory, "libyachiyo_proot_loader.so");
        if (!proot.isFile() || !loader.isFile()) throw new IOException("sandbox_native_runtime_missing");
        File temp = new File(getContext().getCacheDir(), "proot-tmp");
        if (!temp.isDirectory() && !temp.mkdirs()) throw new IOException("sandbox_temp_unavailable");

        List<String> arguments = new ArrayList<>();
        arguments.add(proot.getAbsolutePath());
        arguments.add("--link2symlink");
        arguments.add("-0");
        arguments.add("-r");
        arguments.add(installer.rootfsDirectory().getAbsolutePath());
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
        arguments.add("HOME=/root");
        arguments.add("PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin");
        arguments.add("TERM=xterm-256color");
        arguments.add("LANG=C.UTF-8");
        arguments.add("/bin/sh");
        arguments.add("-lc");
        arguments.add(command);

        ProcessBuilder builder = new ProcessBuilder(arguments);
        builder.directory(workspace);
        builder.environment().put("PROOT_LOADER", loader.getAbsolutePath());
        builder.environment().put("PROOT_TMP_DIR", temp.getAbsolutePath());
        builder.environment().put("PROOT_NO_SECCOMP", "1");
        builder.environment().put("LD_LIBRARY_PATH", installer.runtimeDirectory().getAbsolutePath() + ":" + nativeDirectory.getAbsolutePath());
        Process process = builder.start();
        if (!activeProcess.compareAndSet(null, process)) {
            process.destroyForcibly();
            throw new IOException("sandbox_command_in_progress");
        }
        StreamCollector stdout = new StreamCollector(process.getInputStream());
        StreamCollector stderr = new StreamCollector(process.getErrorStream());
        Thread outThread = new Thread(stdout, "yachiyo-sandbox-stdout");
        Thread errThread = new Thread(stderr, "yachiyo-sandbox-stderr");
        outThread.start();
        errThread.start();
        boolean completed = process.waitFor(timeoutMs, TimeUnit.MILLISECONDS);
        if (!completed) {
            process.destroy();
            if (!process.waitFor(2, TimeUnit.SECONDS)) process.destroyForcibly();
        }
        outThread.join(2_000);
        errThread.join(2_000);
        activeProcess.compareAndSet(process, null);
        return new CommandResult(stdout.text(), stderr.text(), completed ? process.exitValue() : 124);
    }

    private void syncGuestDns() throws Exception {
        ConnectivityManager manager = getContext().getSystemService(ConnectivityManager.class);
        Network activeNetwork = manager == null ? null : manager.getActiveNetwork();
        LinkProperties properties = manager == null || activeNetwork == null ? null : manager.getLinkProperties(activeNetwork);
        List<InetAddress> servers = properties == null ? java.util.Collections.emptyList() : properties.getDnsServers();
        StringBuilder content = new StringBuilder();
        for (InetAddress server : servers) {
            String address = server.getHostAddress();
            if (address != null && !address.trim().isEmpty() && address.indexOf('%') < 0) {
                content.append("nameserver ").append(address).append('\n');
            }
        }
        if (content.length() == 0) content.append("nameserver 1.1.1.1\nnameserver 8.8.8.8\n");
        File resolv = new File(installer.rootfsDirectory(), "etc/resolv.conf");
        if (Files.isSymbolicLink(resolv.toPath())) Files.delete(resolv.toPath());
        try (FileOutputStream output = new FileOutputStream(resolv)) {
            output.write(content.toString().getBytes(StandardCharsets.US_ASCII));
            output.getFD().sync();
        }
    }

    private File workspaceFor(String requested) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] hash = digest.digest((requested == null ? "default" : requested).getBytes(StandardCharsets.UTF_8));
        StringBuilder id = new StringBuilder();
        for (int index = 0; index < 8; index++) id.append(String.format("%02x", hash[index]));
        return new File(getContext().getFilesDir(), "linux-sandbox/workspaces/" + id);
    }

    private File resolveWorkspace(String path) throws Exception {
        requireReady();
        return SandboxPathPolicy.resolveWorkspace(workspace, path);
    }

    private void requireReady() throws IOException {
        if (installer == null || !installer.isInstalled() || !toolchainMarker().isFile()) throw new IOException("sandbox_not_ready");
        if (workspace == null) throw new IOException("sandbox_not_initialized");
    }

    private File toolchainMarker() {
        return new File(installer == null ? getContext().getFilesDir() : installer.rootfsDirectory(), ".yachiyo-toolchain-v1");
    }

    private void emitProgress(String stage, int percent, long transferred, long total) {
        JSObject event = new JSObject();
        event.put("stage", stage);
        event.put("percent", percent);
        event.put("transferred", transferred);
        event.put("total", total);
        notifyListeners("progress", event);
    }

    private JSObject statusObject() {
        return new JSObject()
            .put("success", true)
            .put("state", state)
            .put("installed", installer.isInstalled())
            .put("toolchainReady", toolchainMarker().isFile())
            .put("workingDirectory", workspace == null ? null : workspace.getAbsolutePath())
            .put("platform", "android-proot-alpine")
            .put("distribution", SandboxDistribution.VERSION);
    }

    private static JSObject commandResult(CommandResult result) {
        return new JSObject().put("stdout", result.stdout).put("stderr", result.stderr).put("exitCode", result.exitCode);
    }

    private static JSObject fileError(Exception error, String fallback) {
        return new JSObject().put("success", false).put("error", safeError(error, fallback));
    }

    private static String safeError(Exception error, String fallback) {
        String message = error.getMessage();
        return message != null && message.matches("[A-Za-z0-9._-]{1,120}") ? message : fallback;
    }

    private void killProcess() {
        Process process = activeProcess.getAndSet(null);
        if (process != null) {
            process.destroy();
            process.destroyForcibly();
        }
    }

    private interface FileConsumer {
        void accept(File file, String relative) throws Exception;
    }

    private void walkFiles(File directory, FileConsumer consumer) throws Exception {
        if (!directory.isDirectory()) throw new IOException("sandbox_directory_not_found");
        Path root = workspace.getCanonicalFile().toPath();
        int[] entries = {0};
        Files.walkFileTree(directory.toPath(), new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                if (++entries[0] > MAX_WALK_ENTRIES) throw new IOException("sandbox_walk_limit");
                if (attrs.isRegularFile() && !attrs.isSymbolicLink()) {
                    try {
                        consumer.accept(file.toFile(), root.relativize(file.toAbsolutePath()).toString().replace(File.separatorChar, '/'));
                    } catch (IOException error) {
                        throw error;
                    } catch (Exception error) {
                        throw new IOException("sandbox_walk_failed", error);
                    }
                }
                return FileVisitResult.CONTINUE;
            }
        });
    }

    private static Pattern globPattern(String glob) {
        String value = glob == null || glob.trim().isEmpty() ? "*" : glob;
        if (value.length() > 256 || value.indexOf('\0') >= 0) throw new IllegalArgumentException("sandbox_glob_invalid");
        StringBuilder regex = new StringBuilder("^");
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            if (character == '*') regex.append(".*");
            else if (character == '?') regex.append('.');
            else if (".()[]{}+$^|\\".indexOf(character) >= 0) regex.append('\\').append(character);
            else regex.append(character);
        }
        return Pattern.compile(regex.append('$').toString(), Pattern.CASE_INSENSITIVE);
    }

    private record CommandResult(String stdout, String stderr, int exitCode) {}

    private static final class StreamCollector implements Runnable {
        private final InputStream input;
        private final ByteArrayOutputStream output = new ByteArrayOutputStream();

        StreamCollector(InputStream input) {
            this.input = input;
        }

        @Override
        public void run() {
            byte[] buffer = new byte[16 * 1024];
            try {
                int read;
                while ((read = input.read(buffer)) >= 0) {
                    int remaining = MAX_OUTPUT_BYTES - output.size();
                    if (remaining > 0) output.write(buffer, 0, Math.min(read, remaining));
                }
            } catch (IOException ignored) {
                // Cancellation closes process streams while collector threads drain.
            }
        }

        String text() {
            String value = new String(output.toByteArray(), StandardCharsets.UTF_8);
            return output.size() >= MAX_OUTPUT_BYTES ? value + "\n[output truncated]" : value;
        }
    }
}
