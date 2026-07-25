package io.github.yachiyoclaw.model;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.util.Locale;
import java.util.regex.Pattern;

final class LocalModelFormat {
    private static final Pattern GGUF_SHARD = Pattern.compile(".+-\\d{5}-of-\\d{5}\\.gguf", Pattern.CASE_INSENSITIVE);
    private static final Pattern GGUF_FIRST_SHARD = Pattern.compile(".+-00001-of-\\d{5}\\.gguf", Pattern.CASE_INSENSITIVE);

    private LocalModelFormat() {}

    static boolean isLiteRtLm(String format, String path) {
        return "litertlm".equals(normalize(format)) || lower(path).endsWith(".litertlm");
    }

    static boolean isTflite(String format, String path) {
        return "tflite".equals(normalize(format)) || lower(path).endsWith(".tflite");
    }

    static boolean isGguf(String format, String path) {
        return "gguf".equals(normalize(format)) || lower(path).endsWith(".gguf");
    }

    static boolean isRunnableArtifact(String format, String path) {
        return isLiteRtLm(format, path) || isTflite(format, path) || isRunnableGgufPath(path);
    }

    static boolean isRunnableGgufPath(String path) {
        String fileName = new File(path == null ? "" : path).getName();
        if (!lower(fileName).endsWith(".gguf")) return false;
        return !GGUF_SHARD.matcher(fileName).matches() || GGUF_FIRST_SHARD.matcher(fileName).matches();
    }

    static String chooseRuntimePath(String current, String format, File output) {
        String path = output.getAbsolutePath();
        if (isLiteRtLm(format, path) || isTflite(format, path) || isRunnableGgufPath(path)) return path;
        return current;
    }

    static String runtimeForPath(String path) {
        if (isLiteRtLm("", path)) return "litert-lm";
        if (isRunnableGgufPath(path)) return "llama.cpp";
        if (isTflite("", path)) return "mediapipe-text";
        return null;
    }

    static boolean hasValidGgufHeader(File file) {
        if (file == null || !file.isFile() || file.length() < 8 || !isRunnableGgufPath(file.getPath())) return false;
        byte[] header = new byte[4];
        try (FileInputStream input = new FileInputStream(file)) {
            if (input.read(header) != header.length) return false;
            return header[0] == 'G' && header[1] == 'G' && header[2] == 'U' && header[3] == 'F';
        } catch (IOException ignored) {
            return false;
        }
    }

    static boolean hasCompleteGgufShardSet(File file) {
        if (file == null || !file.isFile()) return false;
        var matcher = GGUF_FIRST_SHARD.matcher(file.getName());
        if (!matcher.matches()) return true;
        String name = file.getName();
        int marker = name.toLowerCase(Locale.ROOT).lastIndexOf("-00001-of-");
        int suffix = name.length() - ".gguf".length();
        if (marker < 0 || suffix <= marker + 10) return false;
        int count;
        try {
            count = Integer.parseInt(name.substring(marker + 10, suffix));
        } catch (NumberFormatException ignored) {
            return false;
        }
        if (count < 1 || count > 99999) return false;
        String prefix = name.substring(0, marker + 1);
        String tail = name.substring(marker + 10);
        for (int index = 1; index <= count; index++) {
            File shard = new File(file.getParentFile(), prefix + String.format(Locale.ROOT, "%05d", index) + "-of-" + tail);
            if (!shard.isFile()) return false;
        }
        return true;
    }

    private static String normalize(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }

    private static String lower(String value) {
        return value == null ? "" : value.toLowerCase(Locale.ROOT);
    }
}
