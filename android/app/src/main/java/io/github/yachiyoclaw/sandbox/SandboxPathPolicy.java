package io.github.yachiyoclaw.sandbox;

import java.io.File;

final class SandboxPathPolicy {
    private SandboxPathPolicy() {}

    static File resolveWorkspace(File workspace, String relativePath) throws Exception {
        String value = relativePath == null || relativePath.trim().isEmpty() ? "." : relativePath;
        if (value.indexOf('\0') >= 0 || value.startsWith("/") || value.contains("\\") || value.length() > 2048) {
            throw new IllegalArgumentException("sandbox_path_invalid");
        }
        File root = workspace.getCanonicalFile();
        File target = new File(root, value).getCanonicalFile();
        if (!target.equals(root) && !target.getPath().startsWith(root.getPath() + File.separator)) {
            throw new IllegalArgumentException("sandbox_path_escape");
        }
        return target;
    }

    static String shellQuote(String value) {
        return "'" + value.replace("'", "'\\''") + "'";
    }
}
