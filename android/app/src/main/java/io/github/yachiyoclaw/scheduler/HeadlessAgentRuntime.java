package io.github.yachiyoclaw.scheduler;

import android.content.Context;
import android.os.Build;
import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.URI;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/** Bounded native OpenAI-compatible loop used when no Activity or WebView exists. */
final class HeadlessAgentRuntime {
    interface CheckpointSink { void save(JSONObject checkpoint) throws Exception; }

    static final class ForegroundRequiredException extends Exception {
        ForegroundRequiredException(String message) { super(message); }
    }

    record Result(String text, JSONArray messages, int steps) {
        JSONObject toJson() throws Exception {
            return new JSONObject().put("text", text).put("steps", steps).put("messages", messages);
        }
    }

    private static final int MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
    private static final int MAX_TOOL_RESULT_BYTES = 256 * 1024;
    private static final int MAX_FILE_BYTES = 4 * 1024 * 1024;
    private static final String BUILTIN_INSTRUCTIONS = """
        You are Yachiyo Claw's headless Android Agent. The Activity and WebView do not exist.
        Use the provided tools proactively when they are needed. Work only inside the private task workspace.
        Inspect before modifying. After a tool error, diagnose it and try a materially different safe approach.
        Do not claim an action succeeded unless the tool result confirms it. Device UI, camera, credentials,
        shell commands, external side effects, and any action requiring user approval are unavailable headlessly;
        explain that the task needs foreground interaction instead of inventing a result. Finish with a concise result.
        """;

    private final Context context;
    private final JSONObject runtime;
    private final File workspace;
    private final CheckpointSink checkpoints;
    private final HeadlessToolBroker broker;
    private final String executionId;
    private final long deadline;

    HeadlessAgentRuntime(Context context, String executionId, JSONObject runtime, CheckpointSink checkpoints) throws Exception {
        this.context = context.getApplicationContext();
        this.runtime = runtime;
        this.checkpoints = checkpoints;
        this.executionId = executionId;
        this.broker = new HeadlessToolBroker(context, runtime.optBoolean("internalTools", true));
        String workspaceId = runtime.getString("workspaceId").replace(':', '_');
        File root = new File(context.getFilesDir(), "headless-agent/workspaces").getCanonicalFile();
        this.workspace = new File(root, workspaceId).getCanonicalFile();
        if (!workspace.toPath().startsWith(root.toPath())) throw new IOException("headless_workspace_escape");
        if (!workspace.isDirectory() && !workspace.mkdirs()) throw new IOException("headless_workspace_unavailable");
        this.deadline = System.currentTimeMillis() + runtime.optInt("timeoutMs", 5 * 60_000);
    }

    Result execute(String prompt) throws Exception {
        JSONArray messages = new JSONArray();
        messages.put(new JSONObject().put("role", "system").put(
            "content",
            runtime.optString("systemPrompt", "") + "\n\n" + BUILTIN_INSTRUCTIONS
        ));
        messages.put(new JSONObject().put("role", "user").put("content", prompt));
        int maximumSteps = runtime.optInt("maxSteps", 10);
        for (int step = 0; step < maximumSteps; step++) {
            if (isStopped()) throw new IOException("headless_timeout");
            save(step, "model_request", messages, null);
            JSONObject assistant = request(messages);
            messages.put(assistant);
            JSONArray calls = assistant.optJSONArray("tool_calls");
            String content = assistant.optString("content", "").trim();
            if (calls == null || calls.length() == 0) {
                if (content.isEmpty()) throw new IOException("headless_empty_model_response");
                save(step, "completed", messages, content);
                return new Result(content, messages, step + 1);
            }
            for (int index = 0; index < calls.length(); index++) {
                JSONObject call = calls.getJSONObject(index);
                JSONObject function = call.getJSONObject("function");
                String name = function.getString("name");
                JSONObject arguments;
                try { arguments = new JSONObject(function.optString("arguments", "{}")); }
                catch (Exception error) { arguments = new JSONObject(); }
                save(step, "tool_prepared:" + name, messages, null);
                JSONObject output;
                try {
                    output = broker.execute(executionId, name, arguments, this::dispatchTool);
                } catch (ForegroundRequiredException foreground) {
                    throw foreground;
                } catch (Exception toolError) {
                    output = new JSONObject().put("ok", false).put("error", safeToolError(toolError));
                }
                messages.put(new JSONObject()
                    .put("role", "tool")
                    .put("tool_call_id", call.getString("id"))
                    .put("name", name)
                    .put("content", clamp(output.toString(), MAX_TOOL_RESULT_BYTES)));
                save(step, "tool_applied:" + name, messages, null);
            }
        }
        throw new ForegroundRequiredException("headless_step_limit_reached");
    }

    private JSONObject request(JSONArray messages) throws Exception {
        URL url = endpoint(runtime.getString("apiHost"));
        HttpURLConnection connection = openPublicHttps(url);
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setConnectTimeout(20_000);
        connection.setReadTimeout(Math.max(15_000, Math.min(runtime.optInt("timeoutMs", 300_000), 300_000)));
        connection.setRequestProperty("Authorization", "Bearer " + runtime.getString("apiKey"));
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        connection.setRequestProperty("Accept-Encoding", "identity");
        JSONObject body = new JSONObject()
            .put("model", runtime.getString("model"))
            .put("messages", messages)
            .put("stream", false)
            .put("tools", toolDefinitions())
            .put("tool_choice", "auto");
        String strength = runtime.optString("reasoningStrength", "medium");
        if (runtime.optString("apiHost").contains("api.yachiyo8000.cn") && !"off".equals(strength)) {
            body.put("reasoning_effort", "max".equals(strength) ? "high" : strength);
        }
        try {
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            try (java.io.OutputStream output = connection.getOutputStream()) { output.write(bytes); }
            int status = connection.getResponseCode();
            byte[] response = readBounded(status >= 400 ? connection.getErrorStream() : connection.getInputStream(), MAX_RESPONSE_BYTES);
            if (status == 401 || status == 403) throw new ForegroundRequiredException("headless_provider_auth_failed");
            if (status < 200 || status >= 300) throw new IOException("headless_provider_http_" + status);
            JSONObject json = new JSONObject(new String(response, StandardCharsets.UTF_8));
            JSONArray choices = json.optJSONArray("choices");
            if (choices == null || choices.length() == 0) throw new IOException("headless_provider_response_invalid");
            JSONObject raw = choices.getJSONObject(0).getJSONObject("message");
            JSONObject message = new JSONObject().put("role", "assistant");
            if (raw.has("content") && !raw.isNull("content")) message.put("content", raw.get("content"));
            else message.put("content", "");
            if (raw.has("tool_calls")) message.put("tool_calls", raw.getJSONArray("tool_calls"));
            return message;
        } finally {
            connection.disconnect();
        }
    }

    private JSONObject dispatchTool(String name, JSONObject args) throws Exception {
        return switch (name) {
            case "time_now" -> new JSONObject().put("ok", true).put("iso8601", Instant.now().toString()).put("epochMs", System.currentTimeMillis());
            case "device_info" -> new JSONObject().put("ok", true).put("manufacturer", Build.MANUFACTURER)
                .put("model", Build.MODEL).put("android", Build.VERSION.RELEASE).put("sdk", Build.VERSION.SDK_INT)
                .put("abis", new JSONArray(Build.SUPPORTED_ABIS));
            case "workspace_list" -> list(args.optString("path", "."));
            case "workspace_read" -> read(args.getString("path"));
            case "workspace_write" -> write(args.getString("path"), args.optString("content", ""));
            case "web_fetch" -> webFetch(args.getString("url"));
            case "web_search" -> webSearch(args.getString("query"));
            case "foreground_required" -> throw new ForegroundRequiredException(clamp(args.optString("reason", "foreground_required"), 500));
            default -> new JSONObject().put("ok", false).put("error", "headless_tool_unknown").put("tool", name);
        };
    }

    private JSONArray toolDefinitions() throws Exception {
        JSONArray tools = new JSONArray();
        tools.put(tool("time_now", "Read the current time.", new JSONObject().put("type", "object").put("properties", new JSONObject()).put("additionalProperties", false)));
        tools.put(tool("device_info", "Read non-sensitive Android device model, OS, SDK, and ABI metadata.", new JSONObject().put("type", "object").put("properties", new JSONObject()).put("additionalProperties", false)));
        tools.put(tool("workspace_list", "List files in the private scheduled-task workspace.", objectSchema(new JSONObject().put("path", stringSchema("Relative directory, default .")), new JSONArray())));
        tools.put(tool("workspace_read", "Read a UTF-8 file from the private scheduled-task workspace.", objectSchema(new JSONObject().put("path", stringSchema("Relative file path")), new JSONArray().put("path"))));
        tools.put(tool("workspace_write", "Atomically write a UTF-8 file in the private scheduled-task workspace.", objectSchema(new JSONObject().put("path", stringSchema("Relative file path")).put("content", stringSchema("File content")), new JSONArray().put("path").put("content"))));
        tools.put(tool("web_fetch", "Fetch a bounded public HTTPS page for research. Private/local network targets are denied.", objectSchema(new JSONObject().put("url", stringSchema("Public HTTPS URL")), new JSONArray().put("url"))));
        tools.put(tool("web_search", "Search the public web with Bing RSS and return bounded XML results.", objectSchema(new JSONObject().put("query", stringSchema("Search query")), new JSONArray().put("query"))));
        tools.put(tool("foreground_required", "Pause and request foreground interaction for device UI, shell, approval, camera, credentials, or external side effects.", objectSchema(new JSONObject().put("reason", stringSchema("Why foreground interaction is required")), new JSONArray().put("reason"))));
        return tools;
    }

    private JSONObject list(String relative) throws Exception {
        File directory = resolve(relative);
        if (!directory.isDirectory()) return new JSONObject().put("ok", false).put("error", "workspace_directory_not_found");
        JSONArray entries = new JSONArray();
        File[] children = directory.listFiles();
        if (children != null) {
            java.util.Arrays.sort(children, (a, b) -> a.getName().compareToIgnoreCase(b.getName()));
            for (int i = 0; i < Math.min(children.length, 500); i++) {
                File child = children[i];
                entries.put(new JSONObject().put("name", child.getName()).put("directory", child.isDirectory()).put("size", child.length()));
            }
        }
        return new JSONObject().put("ok", true).put("entries", entries);
    }

    private JSONObject read(String relative) throws Exception {
        File file = resolve(relative);
        if (!file.isFile() || Files.isSymbolicLink(file.toPath())) return new JSONObject().put("ok", false).put("error", "workspace_file_not_found");
        if (file.length() > MAX_FILE_BYTES) return new JSONObject().put("ok", false).put("error", "workspace_file_too_large");
        return new JSONObject().put("ok", true).put("content", new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
    }

    private JSONObject write(String relative, String content) throws Exception {
        byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_FILE_BYTES) return new JSONObject().put("ok", false).put("error", "workspace_file_too_large");
        File file = resolve(relative);
        File parent = file.getParentFile();
        if (parent == null || (!parent.isDirectory() && !parent.mkdirs())) throw new IOException("workspace_parent_unavailable");
        File temporary = new File(parent, file.getName() + ".headless.tmp");
        try (FileOutputStream output = new FileOutputStream(temporary)) { output.write(bytes); output.getFD().sync(); }
        try { Files.move(temporary.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE); }
        catch (java.nio.file.AtomicMoveNotSupportedException ignored) { Files.move(temporary.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING); }
        return new JSONObject().put("ok", true).put("bytes", bytes.length);
    }

    private JSONObject webFetch(String value) throws Exception {
        HttpURLConnection connection = openPublicHttps(new URL(value));
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(20_000);
        connection.setReadTimeout(30_000);
        connection.setRequestProperty("Accept-Encoding", "identity");
        connection.setRequestProperty("User-Agent", "Yachiyo-Claw-Headless-Agent");
        try {
            int status = connection.getResponseCode();
            byte[] bytes = readBounded(status >= 400 ? connection.getErrorStream() : connection.getInputStream(), 512 * 1024);
            return new JSONObject().put("ok", status >= 200 && status < 300).put("status", status)
                .put("contentType", connection.getContentType()).put("body", new String(bytes, StandardCharsets.UTF_8));
        } finally { connection.disconnect(); }
    }

    private JSONObject webSearch(String query) throws Exception {
        String normalized = query == null ? "" : query.trim();
        if (normalized.isEmpty() || normalized.length() > 500) return new JSONObject().put("ok", false).put("error", "web_search_query_invalid");
        return webFetch("https://www.bing.com/search?format=rss&q=" + URLEncoder.encode(normalized, StandardCharsets.UTF_8));
    }

    private File resolve(String relative) throws Exception {
        if (relative == null || relative.indexOf('\0') >= 0 || relative.indexOf('\\') >= 0 || new File(relative).isAbsolute()) throw new IOException("workspace_path_invalid");
        File target = new File(workspace, relative).getCanonicalFile();
        if (!target.toPath().startsWith(workspace.getCanonicalFile().toPath())) throw new IOException("workspace_path_escape");
        return target;
    }

    private void save(int step, String stage, JSONArray messages, String result) throws Exception {
        JSONObject checkpoint = new JSONObject().put("version", 1).put("step", step).put("stage", stage)
            .put("messageCount", messages.length()).put("updatedAt", System.currentTimeMillis());
        if (result != null) checkpoint.put("result", clamp(result, 8 * 1024));
        checkpoints.save(checkpoint);
    }

    private boolean isStopped() { return System.currentTimeMillis() >= deadline || Thread.currentThread().isInterrupted(); }

    static URL endpoint(String host) throws Exception {
        String value = host.trim().replaceAll("/+$", "");
        if (value.endsWith("/chat/completions")) return new URL(value);
        return new URL(value + "/chat/completions");
    }

    private static HttpURLConnection openPublicHttps(URL url) throws Exception {
        URI uri = url.toURI();
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getRawUserInfo() != null || (uri.getPort() != -1 && uri.getPort() != 443)) {
            throw new IOException("headless_url_rejected");
        }
        InetAddress[] addresses = InetAddress.getAllByName(uri.getHost());
        if (addresses.length == 0) throw new IOException("headless_host_unresolved");
        for (InetAddress address : addresses) if (!isPublic(address)) throw new IOException("headless_private_network_denied");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setInstanceFollowRedirects(false);
        return connection;
    }

    private static boolean isPublic(InetAddress address) {
        if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress() || address.isSiteLocalAddress() || address.isMulticastAddress()) return false;
        byte[] bytes = address.getAddress();
        if (address instanceof Inet4Address) {
            int a = bytes[0] & 255, b = bytes[1] & 255, c = bytes[2] & 255;
            return a != 0 && a != 10 && a != 127 && a < 224 && !(a == 100 && b >= 64 && b <= 127)
                && !(a == 169 && b == 254) && !(a == 172 && b >= 16 && b <= 31) && !(a == 192 && b == 168)
                && !(a == 192 && b == 0 && (c == 0 || c == 2)) && !(a == 198 && (b == 18 || b == 19)) && !(a == 203 && b == 0 && c == 113);
        }
        if (address instanceof Inet6Address) return ((bytes[0] & 0xfe) != 0xfc) && !(bytes[0] == 0x20 && bytes[1] == 0x01 && bytes[2] == 0x0d && (bytes[3] & 255) == 0xb8);
        return false;
    }

    private static byte[] readBounded(java.io.InputStream raw, int maximum) throws Exception {
        if (raw == null) return new byte[0];
        try (BufferedInputStream input = new BufferedInputStream(raw); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16 * 1024];
            int read;
            while ((read = input.read(buffer)) >= 0) {
                if (output.size() + read > maximum) throw new IOException("headless_response_too_large");
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        }
    }

    private static JSONObject tool(String name, String description, JSONObject parameters) throws Exception {
        return new JSONObject().put("type", "function").put("function", new JSONObject()
            .put("name", name).put("description", description).put("parameters", parameters));
    }
    private static JSONObject objectSchema(JSONObject properties, JSONArray required) throws Exception {
        return new JSONObject().put("type", "object").put("properties", properties).put("required", required).put("additionalProperties", false);
    }
    private static JSONObject stringSchema(String description) throws Exception { return new JSONObject().put("type", "string").put("description", description); }
    private static String clamp(String value, int maximum) { return value.length() <= maximum ? value : value.substring(0, maximum) + "\n[truncated]"; }
    static String safeToolError(Exception error) {
        String value = error.getMessage();
        if (value == null || value.isBlank()) return "headless_tool_failed";
        String normalized = value.replace('\0', ' ').trim();
        return normalized.length() <= 160 ? normalized : normalized.substring(0, 160);
    }
}
