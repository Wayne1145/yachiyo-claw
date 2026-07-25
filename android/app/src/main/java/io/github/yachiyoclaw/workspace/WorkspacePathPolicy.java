package io.github.yachiyoclaw.workspace;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;

final class WorkspacePathPolicy {
    private WorkspacePathPolicy() {}

    static File resolve(File root, String relativePath) throws IOException {
        if (relativePath == null || relativePath.indexOf('\0') >= 0) throw new IOException("workspace_path_invalid");
        String normalized = relativePath.replace('\\', '/').trim();
        if (normalized.isEmpty() || normalized.startsWith("/") || normalized.matches("^[A-Za-z]:/.*")) {
            throw new IOException("workspace_path_invalid");
        }
        for (String segment : normalized.split("/")) {
            if (segment.isEmpty() || segment.equals(".") || segment.equals("..")) throw new IOException("workspace_path_traversal");
        }
        File canonicalRoot = root.getCanonicalFile();
        if (Files.isSymbolicLink(root.toPath()) || Files.isSymbolicLink(canonicalRoot.toPath())) {
            throw new IOException("workspace_symlink_not_allowed");
        }
        File lexical = canonicalRoot;
        for (String segment : normalized.split("/")) {
            lexical = new File(lexical, segment);
            if (Files.isSymbolicLink(lexical.toPath())) throw new IOException("workspace_symlink_not_allowed");
        }
        File target = lexical.getCanonicalFile();
        String rootPath = canonicalRoot.getPath() + File.separator;
        if (!target.getPath().startsWith(rootPath)) throw new IOException("workspace_path_traversal");
        return target;
    }
}
