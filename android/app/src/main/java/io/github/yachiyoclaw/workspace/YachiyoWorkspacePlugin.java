package io.github.yachiyoclaw.workspace;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import androidx.documentfile.provider.DocumentFile;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.json.JSONObject;

@CapacitorPlugin(name = "YachiyoWorkspace")
public final class YachiyoWorkspacePlugin extends Plugin {
    private static final String PREFS = "yachiyo_workspace_v1";
    private static final String ACTIVE_URI = "active_uri";
    private static final int MAX_FILES = 20_000;
    private static final long MAX_TOTAL_BYTES = 4L * 1024L * 1024L * 1024L;
    private static final int BUFFER_SIZE = 64 * 1024;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void pickExternalWorkspace(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION |
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        String previous = preferences().getString(ACTIVE_URI, null);
        if (previous != null) intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, Uri.parse(previous));
        startActivityForResult(call, intent, "workspacePicked");
    }

    @ActivityCallback
    private void workspacePicked(PluginCall call, ActivityResult result) {
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.resolve(new JSObject().put("canceled", true));
            return;
        }
        Uri uri = data.getData();
        try {
            int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            if (flags == 0) throw new SecurityException("workspace_grant_missing");
            getContext().getContentResolver().takePersistableUriPermission(uri, flags);
            preferences().edit().putString(ACTIVE_URI, uri.toString()).apply();
            call.resolve(describe(uri).put("canceled", false));
        } catch (RuntimeException | IOException error) {
            call.reject(safeError(error, "workspace_grant_failed"));
        }
    }

    @PluginMethod
    public void getExternalWorkspace(PluginCall call) {
        String value = preferences().getString(ACTIVE_URI, null);
        if (value == null) {
            call.resolve(new JSObject().put("available", false));
            return;
        }
        try {
            call.resolve(describe(Uri.parse(value)).put("available", true));
        } catch (IOException error) {
            call.resolve(new JSObject().put("available", false).put("error", safeError(error, "workspace_unavailable")));
        }
    }

    @PluginMethod
    public void syncFromExternal(PluginCall call) {
        Uri uri = requireActiveUri(call);
        if (uri == null) return;
        executor.execute(() -> {
            try {
                File destination = workspaceFor(uri.toString());
                if (!destination.isDirectory() && !destination.mkdirs()) throw new IOException("workspace_internal_unavailable");
                CopyStats stats = copyFromTree(DocumentFile.fromTreeUri(getContext(), uri), destination);
                call.resolve(stats.toJs().put("success", true).put("workspaceKey", uri.toString()));
            } catch (Exception error) {
                call.resolve(new JSObject().put("success", false).put("error", safeError(error, "workspace_sync_in_failed")));
            }
        });
    }

    @PluginMethod
    public void syncToExternal(PluginCall call) {
        Uri uri = requireActiveUri(call);
        if (uri == null) return;
        executor.execute(() -> {
            try {
                File source = workspaceFor(uri.toString());
                if (!source.isDirectory()) throw new IOException("workspace_internal_unavailable");
                DocumentFile tree = DocumentFile.fromTreeUri(getContext(), uri);
                if (tree == null || !tree.canWrite()) throw new IOException("workspace_external_not_writable");
                CopyStats stats = copyToTree(source, tree);
                call.resolve(stats.toJs().put("success", true));
            } catch (Exception error) {
                call.resolve(new JSObject().put("success", false).put("error", safeError(error, "workspace_sync_out_failed")));
            }
        });
    }

    @PluginMethod
    public void exportZip(PluginCall call) {
        String requestedName = call.getString("name", "yachiyo-project.zip");
        Uri uri = requireActiveUri(call);
        if (uri == null) return;
        executor.execute(() -> {
            try {
                String name = sanitizeZipName(requestedName);
                File directory = new File(getContext().getCacheDir(), "workspace-exports");
                if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("workspace_export_unavailable");
                File zip = new File(directory, UUID.randomUUID() + "-" + name);
                createZip(workspaceFor(uri.toString()), zip);
                Uri contentUri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", zip);
                JSObject response = new JSObject().put("success", true).put("uri", contentUri.toString()).put("name", name).put("bytes", zip.length());
                if (call.getBoolean("share", false)) {
                    Intent share = new Intent(Intent.ACTION_SEND)
                        .setType("application/zip")
                        .putExtra(Intent.EXTRA_STREAM, contentUri)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    getActivity().startActivity(Intent.createChooser(share, "导出项目"));
                    response.put("shared", true);
                }
                call.resolve(response);
            } catch (Exception error) {
                call.resolve(new JSObject().put("success", false).put("error", safeError(error, "workspace_export_failed")));
            }
        });
    }

    @PluginMethod
    public void registerPreview(PluginCall call) {
        int port = call.getInt("port", 0);
        String path = call.getString("path", "/");
        if (port < 1 || port > 65_535 || path == null || !path.startsWith("/") || path.contains("\\") || path.contains("\0")) {
            call.reject("preview_address_invalid");
            return;
        }
        String id = UUID.randomUUID().toString();
        String url = "http://127.0.0.1:" + port + path;
        preferences().edit().putString("preview_" + id, url).apply();
        call.resolve(new JSObject().put("success", true).put("id", id).put("url", url));
    }

    @PluginMethod
    public void openPreview(PluginCall call) {
        String id = call.getString("id", "");
        String url = preferences().getString("preview_" + id, null);
        if (!BrowserNavigationPolicy.isAllowed(url, true)) {
            call.reject("preview_not_found");
            return;
        }
        launchWebView(url, true);
        call.resolve(new JSObject().put("success", true).put("url", url));
    }

    @PluginMethod
    public void browserNavigate(PluginCall call) {
        String url = call.getString("url", "");
        if (!BrowserNavigationPolicy.isAllowed(url, false)) {
            call.resolve(new JSObject().put("success", false).put("error", "browser_url_not_allowed"));
            return;
        }
        if (!ControlledWebViewActivity.load(url, (value, error) -> {
            if (error != null) call.resolve(new JSObject().put("success", false).put("error", error));
            else call.resolve(new JSObject().put("success", true).put("url", url));
        })) {
            launchWebView(url, false);
            call.resolve(new JSObject().put("success", true).put("url", url));
        }
    }

    @PluginMethod
    public void browserClick(PluginCall call) {
        String ref = call.getString("ref");
        String selector = call.getString("selector", "");
        evaluate(call, ControlledBrowserScripts.click(ref, selector), "browser_unavailable");
    }

    @PluginMethod
    public void browserType(PluginCall call) {
        String ref = call.getString("ref");
        String selector = call.getString("selector", "");
        String text = call.getString("text", "");
        evaluate(call, ControlledBrowserScripts.type(ref, selector, text), "browser_unavailable");
    }

    @PluginMethod
    public void browserSnapshot(PluginCall call) {
        evaluate(call, ControlledBrowserScripts.snapshotExpression(), "browser_unavailable");
    }

    @PluginMethod
    public void browserAction(PluginCall call) {
        String action = call.getString("action", "");
        String ref = call.getString("ref");
        String selector = call.getString("selector");
        String value = call.getString("value", "");
        if ("scroll".equals(action)) {
            evaluateWithSnapshot(call, ControlledBrowserScripts.scroll(ref, call.getString("direction", "down"), call.getInt("amount", 700)));
        } else if ("select".equals(action)) {
            evaluateWithSnapshot(call, ControlledBrowserScripts.select(ref, selector, value));
        } else if ("wait".equals(action)) {
            if (!ControlledWebViewActivity.waitFor(ControlledBrowserScripts.waitCondition(ref, selector, value), call.getInt("timeoutMs", 8_000), (result, error) -> {
                if (error != null) call.resolve(new JSObject().put("success", false).put("error", error).put("value", result));
                else evaluate(call, ControlledBrowserScripts.snapshotExpression(), "browser_unavailable");
            })) call.resolve(new JSObject().put("success", false).put("error", "browser_unavailable"));
        } else if ("back".equals(action) || "forward".equals(action) || "reload".equals(action)) {
            if (!ControlledWebViewActivity.history(action, (result, error) -> {
                if (error != null) call.resolve(new JSObject().put("success", false).put("error", error));
                else evaluate(call, ControlledBrowserScripts.snapshotExpression(), "browser_unavailable");
            })) call.resolve(new JSObject().put("success", false).put("error", "browser_unavailable"));
        } else call.resolve(new JSObject().put("success", false).put("error", "browser_action_invalid"));
    }

    private void evaluateWithSnapshot(PluginCall call, String actionScript) {
        if (!ControlledWebViewActivity.evaluate(actionScript, (value, error) -> {
            if (error != null) call.resolve(new JSObject().put("success", false).put("error", error));
            else evaluate(call, ControlledBrowserScripts.snapshotExpression(), "browser_unavailable");
        })) call.resolve(new JSObject().put("success", false).put("error", "browser_unavailable"));
    }

    @PluginMethod
    public void browserScreenshot(PluginCall call) {
        if (!ControlledWebViewActivity.screenshot((value, error) -> {
            if (error != null) call.resolve(new JSObject().put("success", false).put("error", error));
            else call.resolve(new JSObject().put("success", true).put("mimeType", "image/jpeg").put("base64", value));
        })) call.resolve(new JSObject().put("success", false).put("error", "browser_unavailable"));
    }

    private void evaluate(PluginCall call, String script, String unavailable) {
        if (!ControlledWebViewActivity.evaluate(script, (value, error) -> {
            if (error != null) call.resolve(new JSObject().put("success", false).put("error", error));
            else call.resolve(new JSObject().put("success", true).put("value", value));
        })) call.resolve(new JSObject().put("success", false).put("error", unavailable));
    }

    private void launchWebView(String url, boolean previewOnly) {
        Intent intent = new Intent(getContext(), ControlledWebViewActivity.class)
            .putExtra(ControlledWebViewActivity.EXTRA_URL, url)
            .putExtra(ControlledWebViewActivity.EXTRA_PREVIEW_ONLY, previewOnly)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
    }

    private android.content.SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE);
    }

    private Uri requireActiveUri(PluginCall call) {
        String value = preferences().getString(ACTIVE_URI, null);
        if (value == null) call.reject("workspace_not_selected");
        return value == null ? null : Uri.parse(value);
    }

    private JSObject describe(Uri uri) throws IOException {
        DocumentFile tree = DocumentFile.fromTreeUri(getContext(), uri);
        if (tree == null || !tree.exists()) throw new IOException("workspace_unavailable");
        return new JSObject()
            .put("uri", uri.toString())
            .put("workspaceKey", uri.toString())
            .put("displayName", tree.getName() == null ? "外部工作区" : tree.getName())
            .put("internalPath", workspaceFor(uri.toString()).getAbsolutePath())
            .put("canRead", tree.canRead())
            .put("canWrite", tree.canWrite());
    }

    private File workspaceFor(String key) throws IOException {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(key.getBytes(StandardCharsets.UTF_8));
            StringBuilder id = new StringBuilder();
            for (int index = 0; index < 8; index++) id.append(String.format("%02x", digest[index]));
            return new File(getContext().getFilesDir(), "linux-sandbox/workspaces/" + id);
        } catch (java.security.GeneralSecurityException impossible) {
            throw new IOException("workspace_hash_unavailable", impossible);
        }
    }

    private CopyStats copyFromTree(DocumentFile root, File destination) throws IOException {
        if (root == null || !root.isDirectory() || !root.canRead()) throw new IOException("workspace_external_not_readable");
        CopyStats stats = new CopyStats();
        copyFromTreeRecursive(root, destination, stats);
        return stats;
    }

    private void copyFromTreeRecursive(DocumentFile source, File destination, CopyStats stats) throws IOException {
        if (!destination.isDirectory() && !destination.mkdirs()) throw new IOException("workspace_directory_create_failed");
        for (DocumentFile child : source.listFiles()) {
            String name = child.getName();
            if (!isSafeName(name)) throw new IOException("workspace_entry_invalid");
            File target = WorkspacePathPolicy.resolve(destination, name);
            stats.reserve(child.isFile() ? Math.max(0, child.length()) : 0);
            if (child.isDirectory()) {
                WorkspacePathPolicy.resolve(destination, name);
                copyFromTreeRecursive(child, target, stats);
            }
            else if (child.isFile()) {
                // Revalidate immediately before opening because the sandbox may be alive concurrently.
                target = WorkspacePathPolicy.resolve(destination, name);
                File parent = target.getParentFile();
                if (parent == null || Files.isSymbolicLink(parent.toPath()) || Files.isSymbolicLink(target.toPath())) {
                    throw new IOException("workspace_symlink_not_allowed");
                }
                try (InputStream input = new BufferedInputStream(getContext().getContentResolver().openInputStream(child.getUri()));
                     OutputStream output = new BufferedOutputStream(new FileOutputStream(target))) {
                    if (input == null) throw new IOException("workspace_file_open_failed");
                    copy(input, output, stats);
                }
            }
        }
    }

    private CopyStats copyToTree(File source, DocumentFile destination) throws IOException {
        CopyStats stats = new CopyStats();
        copyToTreeRecursive(source, destination, stats);
        return stats;
    }

    private void copyToTreeRecursive(File source, DocumentFile destination, CopyStats stats) throws IOException {
        File[] entries = source.listFiles();
        if (entries == null) return;
        for (File child : entries) {
            if (Files.isSymbolicLink(child.toPath()) || !isSafeName(child.getName())) continue;
            stats.reserve(child.isFile() ? child.length() : 0);
            if (child.isDirectory()) {
                DocumentFile next = destination.findFile(child.getName());
                if (next != null && !next.isDirectory()) throw new IOException("workspace_destination_conflict");
                if (next == null) next = destination.createDirectory(child.getName());
                if (next == null) throw new IOException("workspace_directory_create_failed");
                copyToTreeRecursive(child, next, stats);
            } else if (child.isFile()) {
                DocumentFile target = destination.findFile(child.getName());
                if (target != null && !target.isFile()) throw new IOException("workspace_destination_conflict");
                if (target == null) target = destination.createFile("application/octet-stream", child.getName());
                if (target == null) throw new IOException("workspace_file_create_failed");
                try (InputStream input = new BufferedInputStream(new FileInputStream(child));
                     OutputStream output = new BufferedOutputStream(getContext().getContentResolver().openOutputStream(target.getUri(), "wt"))) {
                    if (output == null) throw new IOException("workspace_file_open_failed");
                    copy(input, output, stats);
                }
            }
        }
    }

    private static void createZip(File source, File outputFile) throws IOException {
        if (!source.isDirectory()) throw new IOException("workspace_internal_unavailable");
        int files = 0;
        long bytes = 0;
        try (ZipOutputStream zip = new ZipOutputStream(new BufferedOutputStream(new FileOutputStream(outputFile)))) {
            Deque<File> queue = new ArrayDeque<>();
            queue.add(source);
            String root = source.getCanonicalPath() + File.separator;
            while (!queue.isEmpty()) {
                File current = queue.removeFirst();
                File[] children = current.listFiles();
                if (children == null) continue;
                for (File child : children) {
                    if (Files.isSymbolicLink(child.toPath())) continue;
                    String canonical = child.getCanonicalPath();
                    if (!canonical.startsWith(root)) throw new IOException("workspace_path_traversal");
                    String relative = canonical.substring(root.length()).replace(File.separatorChar, '/');
                    if (child.isDirectory()) queue.addLast(child);
                    else if (child.isFile()) {
                        files += 1;
                        bytes += child.length();
                        if (files > MAX_FILES || bytes > MAX_TOTAL_BYTES) throw new IOException("workspace_export_limit_exceeded");
                        zip.putNextEntry(new ZipEntry(relative));
                        try (InputStream input = new BufferedInputStream(new FileInputStream(child))) { copyRaw(input, zip); }
                        zip.closeEntry();
                    }
                }
            }
        }
    }

    private static void copy(InputStream input, OutputStream output, CopyStats stats) throws IOException {
        byte[] buffer = new byte[BUFFER_SIZE];
        int read;
        while ((read = input.read(buffer)) >= 0) {
            output.write(buffer, 0, read);
            stats.transferred += read;
            if (stats.transferred > MAX_TOTAL_BYTES) throw new IOException("workspace_size_limit_exceeded");
        }
    }

    private static void copyRaw(InputStream input, OutputStream output) throws IOException {
        byte[] buffer = new byte[BUFFER_SIZE];
        int read;
        while ((read = input.read(buffer)) >= 0) output.write(buffer, 0, read);
    }

    private static boolean isSafeName(String name) {
        return name != null && !name.isEmpty() && !name.equals(".") && !name.equals("..") && name.indexOf('/') < 0 && name.indexOf('\\') < 0 && name.indexOf('\0') < 0;
    }

    private static String sanitizeZipName(String value) {
        String name = value == null ? "yachiyo-project.zip" : value.replaceAll("[^A-Za-z0-9._-]", "_");
        if (name.isEmpty()) name = "yachiyo-project.zip";
        if (!name.toLowerCase(java.util.Locale.ROOT).endsWith(".zip")) name += ".zip";
        return name.length() > 96 ? name.substring(name.length() - 96) : name;
    }

    private static String safeError(Exception error, String fallback) {
        String message = error.getMessage();
        return message != null && message.matches("[A-Za-z0-9._-]{1,120}") ? message : fallback;
    }

    @Override protected void handleOnDestroy() {
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    private static final class CopyStats {
        int files;
        long expected;
        long transferred;

        void reserve(long bytes) throws IOException {
            files += 1;
            expected += bytes;
            if (files > MAX_FILES || expected > MAX_TOTAL_BYTES) throw new IOException("workspace_size_limit_exceeded");
        }

        JSObject toJs() { return new JSObject().put("files", files).put("bytes", transferred); }
    }
}
