package io.github.yachiyoclaw.agent;

import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.PluginCall;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.nio.ByteBuffer;
import org.json.JSONException;

/** Strict native boundary for installed Skill scripts. */
final class SkillScriptRequest {
    static final int MAX_SCRIPT_BYTES = 256 * 1024;
    static final int MAX_ARGUMENTS = 64;
    static final int MAX_ARGUMENT_BYTES = 16 * 1024;

    final String skillName;
    final String backend;
    final String entrypointName;
    final String runtime;
    final byte[] script;
    final String scriptSha256;
    final List<String> args;
    final String workingDirectoryMode;
    final String workspaceDirectory;
    final int timeoutMs;
    final String executionId;
    final boolean signatureVerified;

    private SkillScriptRequest(
        String skillName,
        String backend,
        String entrypointName,
        String runtime,
        byte[] script,
        String scriptSha256,
        List<String> args,
        String workingDirectoryMode,
        String workspaceDirectory,
        int timeoutMs,
        String executionId,
        boolean signatureVerified
    ) {
        this.skillName = skillName;
        this.backend = backend;
        this.entrypointName = entrypointName;
        this.runtime = runtime;
        this.script = script;
        this.scriptSha256 = scriptSha256;
        this.args = args;
        this.workingDirectoryMode = workingDirectoryMode;
        this.workspaceDirectory = workspaceDirectory;
        this.timeoutMs = timeoutMs;
        this.executionId = executionId;
        this.signatureVerified = signatureVerified;
    }

    static SkillScriptRequest from(PluginCall call) throws Exception {
        String skillName = identifier(call.getString("skillName", ""));
        String backend = call.getString("backend", "");
        if (!backend.equals("root") && !backend.equals("shizuku")) throw new IllegalArgumentException("invalid_skill_backend");
        String entrypointName = identifier(call.getString("entrypointName", ""));
        String runtime = call.getString("runtime", "");
        if (!runtime.equals("shell") && !runtime.equals("python") && !runtime.equals("javascript")) {
            throw new IllegalArgumentException("unsupported_skill_runtime");
        }
        String expectedHash = call.getString("scriptSha256", "").toLowerCase(Locale.ROOT);
        if (!expectedHash.matches("^[a-f0-9]{64}$")) throw new IllegalArgumentException("invalid_script_hash");
        byte[] script;
        try {
            script = Base64.decode(call.getString("scriptBase64", ""), Base64.DEFAULT);
        } catch (IllegalArgumentException error) {
            throw new IllegalArgumentException("invalid_script_encoding", error);
        }
        if (script.length == 0 || script.length > MAX_SCRIPT_BYTES) throw new IllegalArgumentException("invalid_script_size");
        if (!sha256(script).equals(expectedHash)) throw new SecurityException("script_hash_mismatch");

        String workingDirectoryMode = call.getString("workingDirectoryMode", "skill-private");
        if (!workingDirectoryMode.equals("skill-private") && !workingDirectoryMode.equals("workspace")) {
            throw new IllegalArgumentException("invalid_skill_working_directory_mode");
        }
        String workspaceDirectory = call.getString("workspaceDirectory", "").trim();
        if (!workspaceDirectory.startsWith("/") || workspaceDirectory.indexOf('\0') >= 0 || workspaceDirectory.indexOf('\n') >= 0 || workspaceDirectory.indexOf('\r') >= 0) {
            throw new IllegalArgumentException("invalid_skill_working_directory");
        }

        JSArray rawArgs = call.getArray("args", new JSArray());
        if (rawArgs.length() > MAX_ARGUMENTS) throw new IllegalArgumentException("too_many_skill_arguments");
        List<String> args = new ArrayList<>();
        int argumentBytes = 0;
        for (int index = 0; index < rawArgs.length(); index++) {
            String value;
            try {
                value = rawArgs.getString(index);
            } catch (JSONException error) {
                throw new IllegalArgumentException("invalid_skill_argument", error);
            }
            if (value == null || value.indexOf('\0') >= 0) throw new IllegalArgumentException("invalid_skill_argument");
            argumentBytes += value.getBytes(StandardCharsets.UTF_8).length;
            if (argumentBytes > MAX_ARGUMENT_BYTES) throw new IllegalArgumentException("skill_arguments_too_large");
            args.add(value);
        }
        int timeout = Math.max(1_000, Math.min(call.getInt("timeout", 30_000), 120_000));
        String executionId = call.getString("executionId", "").trim();
        if (!executionId.matches("^[A-Za-z0-9._-]{8,128}$")) throw new IllegalArgumentException("invalid_skill_execution_id");
        boolean signatureVerified = call.getBoolean("signatureVerified", false);
        return new SkillScriptRequest(skillName, backend, entrypointName, runtime, script, expectedHash, args, workingDirectoryMode, workspaceDirectory, timeout, executionId, signatureVerified);
    }

    String executable() {
        if (runtime.equals("shell")) return "/system/bin/sh";
        if (runtime.equals("python")) return "python3";
        return "node";
    }

    static String shellQuote(String value) {
        return "'" + value.replace("'", "'\\''") + "'";
    }

    String bindingDigest() throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        updateDigest(digest, skillName);
        updateDigest(digest, backend);
        updateDigest(digest, entrypointName);
        updateDigest(digest, runtime);
        updateDigest(digest, scriptSha256);
        updateDigest(digest, workingDirectoryMode);
        updateDigest(digest, workspaceDirectory);
        updateDigest(digest, Integer.toString(timeoutMs));
        updateDigest(digest, executionId);
        updateDigest(digest, Boolean.toString(signatureVerified));
        for (String argument : args) updateDigest(digest, argument);
        StringBuilder result = new StringBuilder(64);
        for (byte item : digest.digest()) result.append(String.format(Locale.ROOT, "%02x", item & 0xff));
        return result.toString();
    }

    private static void updateDigest(MessageDigest digest, String value) {
        byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
        digest.update(ByteBuffer.allocate(4).putInt(bytes.length).array());
        digest.update(bytes);
    }

    private static String identifier(String value) {
        String normalized = value == null ? "" : value.trim();
        if (!normalized.matches("^[a-z0-9]+(?:[-_.][a-z0-9]+)*$")) throw new IllegalArgumentException("invalid_skill_identifier");
        return normalized;
    }

    private static String sha256(byte[] value) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(value);
        StringBuilder result = new StringBuilder(64);
        for (byte item : digest) result.append(String.format(Locale.ROOT, "%02x", item & 0xff));
        return result.toString();
    }
}
