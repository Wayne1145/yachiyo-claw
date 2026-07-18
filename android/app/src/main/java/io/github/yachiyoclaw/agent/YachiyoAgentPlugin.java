package io.github.yachiyoclaw.agent;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "YachiyoAgent")
public class YachiyoAgentPlugin extends Plugin {

    private static final int MAX_COMMAND_LENGTH = 32_768;
    private static final int MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
    private static final int ADB_ROOT_BRIDGE_PORT = 39_280;
    private static final String ADB_ROOT_BRIDGE_TOKEN_FILE = "yachiyo-root-bridge-token";
    private static final String EXIT_MARKER = "__YACHIYO_EXIT_CODE__=";
    private static final String PREFERENCES_NAME = "yachiyo-agent";
    private static final String WORKING_DIRECTORY_URI_KEY = "working-directory-uri";
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private volatile Process activeProcess;
    private volatile Socket activeSocket;

    @PluginMethod
    public void checkRoot(PluginCall call) {
        executor.submit(() -> {
            try {
                RootProbe probe = probeRootAccess();
                JSObject response = new JSObject();
                response.put("available", probe.available);
                response.put("detail", probe.detail);
                call.resolve(response);
            } catch (Exception error) {
                JSObject response = new JSObject();
                response.put("available", false);
                response.put("detail", error.getClass().getSimpleName());
                call.resolve(response);
            }
        });
    }

    @PluginMethod
    public void execRoot(PluginCall call) {
        String command = call.getString("command", "").trim();
        int timeout = Math.max(1_000, Math.min(call.getInt("timeout", 120_000), 120_000));
        if (command.isEmpty() || command.length() > MAX_COMMAND_LENGTH) {
            call.reject("invalid_command");
            return;
        }

        executor.submit(() -> {
            try {
                CommandResult result = execute(command, timeout);
                JSObject response = new JSObject();
                response.put("stdout", result.stdout);
                response.put("stderr", result.stderr);
                response.put("exitCode", result.exitCode);
                response.put("timedOut", result.timedOut);
                call.resolve(response);
            } catch (Exception error) {
                call.reject("root_execution_failed", error);
            }
        });
    }

    @PluginMethod
    public void kill(PluginCall call) {
        Process process = activeProcess;
        if (process != null) {
            process.destroy();
            process.destroyForcibly();
        }
        Socket socket = activeSocket;
        if (socket != null) {
            try {
                socket.close();
            } catch (IOException ignored) {}
        }
        JSObject response = new JSObject();
        response.put("killed", process != null || socket != null);
        call.resolve(response);
    }

    @PluginMethod
    public void pickWorkingDirectory(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION |
            Intent.FLAG_GRANT_WRITE_URI_PERMISSION |
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION |
            Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
        );
        String previousUri = getContext()
            .getSharedPreferences(PREFERENCES_NAME, android.content.Context.MODE_PRIVATE)
            .getString(WORKING_DIRECTORY_URI_KEY, null);
        if (previousUri != null) {
            intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, Uri.parse(previousUri));
        }
        startActivityForResult(call, intent, "workingDirectoryResult");
    }

    @ActivityCallback
    @SuppressLint("WrongConstant")
    private void workingDirectoryResult(PluginCall call, ActivityResult result) {
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            JSObject response = new JSObject();
            response.put("canceled", true);
            call.resolve(response);
            return;
        }

        Uri treeUri = data.getData();
        String path;
        try {
            int permissionFlags = data.getFlags() &
                (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            if (permissionFlags == 0) throw new SecurityException("working_directory_grant_missing");
            getContext().getContentResolver().takePersistableUriPermission(treeUri, permissionFlags);
            path = resolveDocumentIdToPath(DocumentsContract.getTreeDocumentId(treeUri));
        } catch (RuntimeException error) {
            call.reject("working_directory_permission_failed", error);
            return;
        }

        if (path == null) {
            call.reject("unsupported_working_directory");
            return;
        }

        getContext()
            .getSharedPreferences(PREFERENCES_NAME, android.content.Context.MODE_PRIVATE)
            .edit()
            .putString(WORKING_DIRECTORY_URI_KEY, treeUri.toString())
            .apply();

        JSObject response = new JSObject();
        response.put("canceled", false);
        response.put("path", path);
        response.put("uri", treeUri.toString());
        call.resolve(response);
    }

    static String resolveDocumentIdToPath(String documentId) {
        if (documentId == null || documentId.indexOf('\0') >= 0 || documentId.indexOf('\n') >= 0) return null;
        int separator = documentId.indexOf(':');
        if (separator < 0) return null;

        String volume = documentId.substring(0, separator);
        String relativePath = documentId.substring(separator + 1);
        for (String segment : relativePath.split("/")) {
            if (segment.equals("..")) return null;
        }

        if (volume.equalsIgnoreCase("raw")) {
            return relativePath.startsWith("/") ? relativePath : null;
        }

        String root = volume.equalsIgnoreCase("primary") ? "/storage/emulated/0" : "/storage/" + volume;
        return relativePath.isEmpty() ? root : root + "/" + relativePath;
    }

    @Override
    protected void handleOnDestroy() {
        Process process = activeProcess;
        if (process != null) {
            process.destroyForcibly();
        }
        Socket socket = activeSocket;
        if (socket != null) {
            try {
                socket.close();
            } catch (IOException ignored) {}
        }
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    private synchronized CommandResult execute(String command, int timeoutMs) throws Exception {
        if (android.os.Process.myUid() == 0) {
            return executeDirect(command, timeoutMs);
        }
        try {
            return executeWithSu(command, timeoutMs);
        } catch (IOException noSuBinary) {
            // Root-enabled emulators often expose root adbd without shipping a su binary.
            return executeWithAdbRootBridge(command, timeoutMs);
        }
    }

    private RootProbe probeRootAccess() {
        if (android.os.Process.myUid() == 0) {
            return new RootProbe(true, "原生 Root（应用进程 UID 0）");
        }

        try {
            CommandResult suResult = executeWithSu("id -u", 10_000);
            if (suResult.exitCode == 0 && suResult.stdout.trim().equals("0")) {
                return new RootProbe(true, detectRootManagerName());
            }
            String detail = !suResult.stderr.trim().isEmpty() ? suResult.stderr.trim() : suResult.stdout.trim();
            try {
                CommandResult bridgeResult = executeWithAdbRootBridge("id -u", 4_000);
                if (bridgeResult.exitCode == 0 && bridgeResult.stdout.trim().equals("0")) {
                    return new RootProbe(true, "原生 root adbd bridge");
                }
            } catch (Exception ignored) {}
            return new RootProbe(false, detail.isEmpty() ? "Root 管理器未授权" : detail);
        } catch (Exception suError) {
            try {
                CommandResult bridgeResult = executeWithAdbRootBridge("id -u", 4_000);
                if (bridgeResult.exitCode == 0 && bridgeResult.stdout.trim().equals("0")) {
                    return new RootProbe(true, "原生 root adbd bridge");
                }
            } catch (Exception ignored) {}
            return new RootProbe(false, "未检测到可用的 Magisk、KernelSU、APatch、su 或 root adbd bridge");
        }
    }

    private String detectRootManagerName() {
        if (isPackageInstalled("me.weishu.kernelsu")) return "KernelSU 已授权";
        if (isPackageInstalled("me.bmax.apatch") || isPackageInstalled("me.bmax.apatch.next")) return "APatch 已授权";
        if (isPackageInstalled("com.topjohnwu.magisk")) return "Magisk 已授权";
        return "Root Shell 已授权（兼容 Magisk、KernelSU、APatch 和标准 su）";
    }

    private boolean isPackageInstalled(String packageName) {
        try {
            getContext().getPackageManager().getPackageInfo(packageName, 0);
            return true;
        } catch (android.content.pm.PackageManager.NameNotFoundException ignored) {
            return false;
        }
    }

    private CommandResult executeDirect(String command, int timeoutMs) throws Exception {
        Process process = new ProcessBuilder("sh", "-c", command).start();
        return collectProcess(process, timeoutMs);
    }

    private CommandResult executeWithSu(String command, int timeoutMs) throws Exception {
        Process process = new ProcessBuilder("su", "-c", command).start();
        return collectProcess(process, timeoutMs);
    }

    private CommandResult collectProcess(Process process, int timeoutMs) throws Exception {
        activeProcess = process;
        StreamCollector stdout = new StreamCollector(process.getInputStream());
        StreamCollector stderr = new StreamCollector(process.getErrorStream());
        Thread stdoutThread = new Thread(stdout, "yachiyo-agent-stdout");
        Thread stderrThread = new Thread(stderr, "yachiyo-agent-stderr");
        stdoutThread.start();
        stderrThread.start();

        boolean finished = process.waitFor(timeoutMs, TimeUnit.MILLISECONDS);
        if (!finished) {
            process.destroy();
            process.destroyForcibly();
        }
        stdoutThread.join(2_000);
        stderrThread.join(2_000);
        int exitCode = finished ? process.exitValue() : 124;
        activeProcess = null;
        return new CommandResult(stdout.getText(), stderr.getText(), exitCode, !finished);
    }

    private CommandResult executeWithAdbRootBridge(String command, int timeoutMs) throws Exception {
        String token = readAdbRootBridgeToken();
        Socket socket = new Socket();
        activeSocket = socket;
        try {
            socket.connect(new InetSocketAddress("127.0.0.1", ADB_ROOT_BRIDGE_PORT), 1_500);
            socket.setSoTimeout(timeoutMs);
            String payload = token + "\n" + command + "\nprintf '\\n" + EXIT_MARKER + "%s\\n' \"$?\"\nexit\n";
            OutputStream output = socket.getOutputStream();
            output.write(payload.getBytes(StandardCharsets.UTF_8));
            output.flush();
            socket.shutdownOutput();

            ByteArrayOutputStream response = new ByteArrayOutputStream();
            byte[] buffer = new byte[8_192];
            boolean timedOut = false;
            try {
                int read;
                while ((read = socket.getInputStream().read(buffer)) != -1 && response.size() < MAX_OUTPUT_BYTES) {
                    response.write(buffer, 0, Math.min(read, MAX_OUTPUT_BYTES - response.size()));
                }
            } catch (SocketTimeoutException timeout) {
                timedOut = true;
            }

            String text = new String(response.toByteArray(), StandardCharsets.UTF_8);
            int markerIndex = text.lastIndexOf(EXIT_MARKER);
            int exitCode = timedOut ? 124 : 1;
            if (markerIndex >= 0) {
                int valueStart = markerIndex + EXIT_MARKER.length();
                int valueEnd = text.indexOf('\n', valueStart);
                String value = text.substring(valueStart, valueEnd >= 0 ? valueEnd : text.length()).trim();
                try {
                    exitCode = Integer.parseInt(value);
                } catch (NumberFormatException ignored) {}
                text = trimTrailingWhitespace(text.substring(0, markerIndex));
            }
            return new CommandResult(text, "", exitCode, timedOut);
        } finally {
            activeSocket = null;
            try {
                socket.close();
            } catch (IOException ignored) {}
        }
    }

    private String readAdbRootBridgeToken() throws IOException {
        java.io.File tokenFile = new java.io.File(getContext().getFilesDir(), ADB_ROOT_BRIDGE_TOKEN_FILE);
        if (!tokenFile.isFile()) throw new IOException("adb_root_bridge_token_missing");
        String token = new String(java.nio.file.Files.readAllBytes(tokenFile.toPath()), StandardCharsets.US_ASCII).trim();
        if (!token.matches("^[a-f0-9]{64}$")) throw new IOException("adb_root_bridge_token_invalid");
        return token;
    }

    private static String trimTrailingWhitespace(String value) {
        int end = value.length();
        while (end > 0 && Character.isWhitespace(value.charAt(end - 1))) {
            end--;
        }
        return value.substring(0, end);
    }

    private static final class StreamCollector implements Runnable {
        private final InputStream input;
        private final ByteArrayOutputStream output = new ByteArrayOutputStream();

        StreamCollector(InputStream input) {
            this.input = input;
        }

        @Override
        public void run() {
            byte[] buffer = new byte[8_192];
            try {
                int read;
                while ((read = input.read(buffer)) != -1 && output.size() < MAX_OUTPUT_BYTES) {
                    output.write(buffer, 0, Math.min(read, MAX_OUTPUT_BYTES - output.size()));
                }
            } catch (IOException ignored) {
                // A cancelled process closes its streams while collectors are still draining.
            }
        }

        String getText() {
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private static final class CommandResult {
        final String stdout;
        final String stderr;
        final int exitCode;
        final boolean timedOut;

        CommandResult(String stdout, String stderr, int exitCode, boolean timedOut) {
            this.stdout = stdout;
            this.stderr = stderr;
            this.exitCode = exitCode;
            this.timedOut = timedOut;
        }
    }

    private static final class RootProbe {
        final boolean available;
        final String detail;

        RootProbe(boolean available, String detail) {
            this.available = available;
            this.detail = detail;
        }
    }
}
