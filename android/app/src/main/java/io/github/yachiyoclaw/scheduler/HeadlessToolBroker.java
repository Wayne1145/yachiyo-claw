package io.github.yachiyoclaw.scheduler;

import android.content.Context;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Set;
import org.json.JSONObject;

/** Default-deny policy and audit boundary between headless model output and native tools. */
final class HeadlessToolBroker {
    interface Dispatcher { JSONObject execute(String name, JSONObject arguments) throws Exception; }

    private static final Set<String> ALLOWED = Set.of(
        "time_now", "device_info", "workspace_list", "workspace_read", "workspace_write", "web_fetch", "web_search", "foreground_required"
    );
    private final File auditFile;
    private final boolean internalTools;

    HeadlessToolBroker(Context context, boolean internalTools) {
        this.internalTools = internalTools;
        this.auditFile = new File(context.getFilesDir(), "headless-agent/audit-v1.jsonl");
    }

    JSONObject execute(String executionId, String name, JSONObject arguments, Dispatcher dispatcher) throws Exception {
        if (!ALLOWED.contains(name)) {
            audit(executionId, name, arguments, "denied", "headless_tool_unknown");
            return new JSONObject().put("ok", false).put("error", "headless_tool_unknown").put("tool", name);
        }
        if (!internalTools && (name.startsWith("workspace_") || name.startsWith("web_"))) {
            audit(executionId, name, arguments, "denied", "headless_internal_tools_disabled");
            return new JSONObject().put("ok", false).put("error", "headless_internal_tools_disabled");
        }
        try {
            JSONObject result = dispatcher.execute(name, arguments);
            audit(executionId, name, arguments, "ok", "");
            return result;
        } catch (HeadlessAgentRuntime.ForegroundRequiredException foreground) {
            audit(executionId, name, arguments, "foreground-required", foreground.getMessage());
            throw foreground;
        } catch (Exception error) {
            audit(executionId, name, arguments, "failed", safe(error.getMessage()));
            throw error;
        }
    }

    private synchronized void audit(String executionId, String name, JSONObject arguments, String outcome, String error) {
        try {
            File parent = auditFile.getParentFile();
            if (parent != null && !parent.isDirectory() && !parent.mkdirs()) return;
            JSONObject row = new JSONObject()
                .put("schemaVersion", 1)
                .put("at", System.currentTimeMillis())
                .put("executionId", executionId)
                .put("tool", name)
                .put("parameterDigest", sha256(arguments.toString()))
                .put("outcome", outcome);
            if (error != null && !error.isBlank()) row.put("error", safe(error));
            try (FileOutputStream output = new FileOutputStream(auditFile, true)) {
                output.write((row + "\n").getBytes(StandardCharsets.UTF_8));
                output.getFD().sync();
            }
        } catch (Exception ignored) {
            // Execution state remains durable even if the append-only diagnostic log is unavailable.
        }
    }

    private static String sha256(String value) throws Exception {
        byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder(64);
        for (byte item : bytes) result.append(String.format("%02x", item));
        return result.toString();
    }

    private static String safe(String value) {
        if (value == null) return "";
        String normalized = value.replace('\0', ' ').trim();
        return normalized.length() <= 160 ? normalized : normalized.substring(0, 160);
    }
}
