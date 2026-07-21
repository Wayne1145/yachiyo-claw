package io.github.yachiyoclaw.model;

import java.io.File;
import java.net.MalformedURLException;
import java.net.URL;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

final class ModelDownloadPolicy {
    static final long MAX_MODEL_BYTES = 15L * 1024L * 1024L * 1024L;
    static final int MAX_REDIRECTS = 6;
    private static final Pattern SHA256 = Pattern.compile("(?i)^[0-9a-f]{64}$");
    private static final Set<String> INITIAL_HOSTS = Set.of("huggingface.co", "www.modelscope.cn", "modelscope.cn");

    private ModelDownloadPolicy() {}

    static URL requireInitialUrl(String value) throws MalformedURLException {
        URL url = new URL(value == null ? "" : value);
        String host = url.getHost().toLowerCase(Locale.ROOT);
        if (!isHttps(url) || !INITIAL_HOSTS.contains(host)) throw new IllegalArgumentException("model_url_not_allowed");
        return url;
    }

    static void requireAllowedRedirect(URL url) {
        if (!isHttps(url)) throw new IllegalArgumentException("model_redirect_not_allowed");
        String host = url.getHost().toLowerCase(Locale.ROOT);
        boolean huggingFace = host.equals("huggingface.co") || host.endsWith(".huggingface.co") ||
            host.endsWith(".hf.co") || host.endsWith(".xethub.hf.co") || host.equals("cdn-lfs-us-1.hf.co");
        boolean modelScope = host.equals("modelscope.cn") || host.endsWith(".modelscope.cn") ||
            host.equals("modelscope.oss-cn-beijing.aliyuncs.com") ||
            host.equals("modelscope.oss-cn-hangzhou.aliyuncs.com") ||
            host.equals("ms-models.oss-cn-hangzhou.aliyuncs.com");
        if (!huggingFace && !modelScope) throw new IllegalArgumentException("model_redirect_not_allowed");
    }

    static String requireSha256(String value) {
        String normalized = value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
        if (!SHA256.matcher(normalized).matches()) throw new IllegalArgumentException("model_hash_required");
        return normalized;
    }

    static long requireSize(long value) {
        if (value <= 0 || value > MAX_MODEL_BYTES) throw new IllegalArgumentException("model_size_invalid");
        return value;
    }

    static File resolveArtifact(File root, String relativePath) throws Exception {
        if (relativePath == null || relativePath.trim().isEmpty() || relativePath.contains("\\")) {
            throw new IllegalArgumentException("model_path_invalid");
        }
        File result = new File(root, relativePath).getCanonicalFile();
        String prefix = root.getCanonicalPath() + File.separator;
        if (!result.getPath().startsWith(prefix)) throw new IllegalArgumentException("model_path_invalid");
        return result;
    }

    private static boolean isHttps(URL url) {
        return "https".equalsIgnoreCase(url.getProtocol()) && url.getUserInfo() == null && url.getPort() == -1;
    }
}
