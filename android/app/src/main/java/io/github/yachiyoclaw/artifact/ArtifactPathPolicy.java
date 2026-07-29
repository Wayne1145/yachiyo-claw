package io.github.yachiyoclaw.artifact;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;

final class ArtifactPathPolicy {
    private ArtifactPathPolicy() {}

    static File workspace(File filesDir, String key) throws Exception {
        if (key == null || key.isBlank() || key.length() > 4096 || key.indexOf('\0') >= 0) {
            throw new IOException("artifact_workspace_invalid");
        }
        byte[] hash = MessageDigest.getInstance("SHA-256").digest(key.getBytes(StandardCharsets.UTF_8));
        StringBuilder id = new StringBuilder();
        for (int index = 0; index < 8; index++) id.append(String.format("%02x", hash[index]));
        return new File(filesDir, "linux-sandbox/workspaces/" + id).getCanonicalFile();
    }

    static File resolve(File workspace, String relativePath) throws Exception {
        if (relativePath == null || relativePath.isBlank() || relativePath.indexOf('\0') >= 0) throw new IOException("artifact_path_invalid");
        String normalized = relativePath.replace('\\', '/').trim();
        if (normalized.startsWith("/") || normalized.matches("^[A-Za-z]:/.*")) throw new IOException("artifact_path_invalid");
        File current = workspace.getCanonicalFile();
        for (String segment : normalized.split("/")) {
            if (segment.isBlank() || segment.equals(".") || segment.equals("..")) throw new IOException("artifact_path_traversal");
            current = new File(current, segment);
            if (Files.isSymbolicLink(current.toPath())) throw new IOException("artifact_symlink_not_allowed");
        }
        File target = current.getCanonicalFile();
        if (!target.getPath().startsWith(workspace.getCanonicalPath() + File.separator)) throw new IOException("artifact_path_traversal");
        return target;
    }
}
