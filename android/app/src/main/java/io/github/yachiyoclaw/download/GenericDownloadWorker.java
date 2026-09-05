package io.github.yachiyoclaw.download;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.File;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.URI;
import java.net.URL;
import org.json.JSONObject;

/** Generic persistent transport used by plugin, Skill, theme, and other bounded app downloads. */
public final class GenericDownloadWorker extends Worker {
    static final String KEY_ID = "id";
    static final long MAX_BYTES = 512L * 1024L * 1024L;

    public GenericDownloadWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    static String workName(String id) { return "yachiyo-download-" + id; }

    static File artifact(Context context, String id) {
        return new File(new File(context.getFilesDir(), "download-cache/generic"), id + ".bin");
    }

    static void enqueue(Context context, String id) {
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(GenericDownloadWorker.class)
            .setInputData(new Data.Builder().putString(KEY_ID, id).build())
            .setConstraints(YachiyoDownloadSettingsPlugin.constraints(context))
            .addTag("yachiyo-generic-download")
            .build();
        WorkManager.getInstance(context).enqueueUniqueWork(workName(id), ExistingWorkPolicy.REPLACE, request);
    }

    /** Replaces active workers so newly saved WorkManager network constraints take effect now. */
    static void reapplyActiveDownloadConstraints(Context context) {
        org.json.JSONArray tasks = DownloadTaskStore.list(context);
        for (int index = 0; index < tasks.length(); index++) {
            JSONObject task = tasks.optJSONObject(index);
            if (task == null) continue;
            String id = task.optString("id", "");
            String status = task.optString("status", "");
            if (("queued".equals(status) || "downloading".equals(status))
                && GenericDownloadStore.get(context, id) != null) {
                enqueue(context, id);
            }
        }
    }

    @NonNull @Override public Result doWork() {
        String id = getInputData().getString(KEY_ID);
        JSONObject request = id == null ? null : GenericDownloadStore.get(getApplicationContext(), id);
        if (request == null) {
            if (id != null) {
                JSONObject task = DownloadTaskStore.get(getApplicationContext(), id);
                DownloadTransfer.discard(artifact(getApplicationContext(), id));
                if (task != null) {
                    DownloadTaskStore.update(
                        getApplicationContext(), id, task.optString("kind", "resource"),
                        task.optString("title", "Download"), "failed", 0,
                        task.optLong("bytesTotal", 0), 0, "download_request_missing"
                    );
                    DownloadTaskStore.releaseGenericPayload(getApplicationContext(), id);
                }
            }
            return Result.failure();
        }
        String kind = request.optString("kind", "resource");
        String title = request.optString("title", "下载任务");
        long total = request.optLong("expectedSize", 0);
        String digest = request.optString("expectedSha256", "");
        File target = artifact(getApplicationContext(), id);
        try {
            if (total <= 0 || total > MAX_BYTES) throw new IllegalArgumentException("download_size_invalid");
            if (DownloadTaskStore.shouldStop(getApplicationContext(), id)) return Result.success();
            File parent = target.getParentFile();
            if (parent != null && !parent.isDirectory() && !parent.mkdirs()) throw new IllegalStateException("download_storage_unavailable");
            long existing = DownloadTransfer.resumableBytes(target, total);
            DownloadTaskStore.updateGeneric(getApplicationContext(), id, kind, title, "downloading", existing, total, 0, null);
            setForegroundAsync(DownloadNotifications.foreground(getApplicationContext(), id, title, existing, total));
            URL initial = requirePublicHttps(request.getString("url"));
            try {
                transfer(id, kind, title, target, total, digest, initial);
            } catch (Exception primaryError) {
                String fallback = request.optString("fallbackUrl", "");
                if (fallback.isBlank() || isStopped() || DownloadTaskStore.shouldStop(getApplicationContext(), id)) throw primaryError;
                DownloadTransfer.discard(target);
                DownloadTaskStore.updateGeneric(getApplicationContext(), id, kind, title, "downloading", 0, total, 0, null);
                transfer(id, kind, title, target, total, digest, requirePublicHttps(fallback));
            }
            DownloadTaskStore.updateGeneric(getApplicationContext(), id, kind, title, "completed", total, total, 0, null);
            DownloadNotifications.complete(getApplicationContext(), id, title);
            return Result.success();
        } catch (Exception error) {
            String stored = DownloadTaskStore.status(getApplicationContext(), id);
            if (DownloadTaskStore.shouldIgnoreStoppedWorkerResult(stored, isStopped())) return Result.success();
            String status = "paused".equals(stored) || "cancelled".equals(stored) ? stored : (isStopped() ? "paused" : "failed");
            long bytes = DownloadTransfer.resumableBytes(target, total);
            if ("cancelled".equals(status)) {
                DownloadTransfer.discard(target);
                GenericDownloadStore.remove(getApplicationContext(), id);
                bytes = 0;
            }
            DownloadTaskStore.updateGeneric(getApplicationContext(), id, kind, title, status, bytes, total, 0, safe(error));
            if ("cancelled".equals(status)) DownloadTaskStore.releaseGenericPayload(getApplicationContext(), id);
            if ("failed".equals(status)) DownloadNotifications.failed(getApplicationContext(), id, title);
            else DownloadNotifications.cancel(getApplicationContext(), id);
            return "failed".equals(status) ? Result.failure() : Result.success();
        }
    }

    private void transfer(String id, String kind, String title, File target, long total, String digest, URL source)
        throws Exception {
        DownloadTransfer.download(
            target,
            total,
            digest,
            YachiyoDownloadSettingsPlugin.threads(getApplicationContext()),
            YachiyoDownloadSettingsPlugin.retryCount(getApplicationContext()),
            (start, end) -> open(getApplicationContext(), source, "GET", start, end),
            (bytes, expected, speed) -> {
                DownloadTaskStore.updateGeneric(getApplicationContext(), id, kind, title, "downloading", bytes, expected, speed, null);
                DownloadNotifications.show(getApplicationContext(), id, title, bytes, expected, speed);
                setForegroundAsync(DownloadNotifications.foreground(getApplicationContext(), id, title, bytes, expected, speed));
            },
            () -> isStopped() || DownloadTaskStore.shouldStop(getApplicationContext(), id)
        );
    }

    /**
     * Resolves a bounded public HTTPS resource using the exact redirect/proxy policy used by the
     * persistent worker. Keeping probing native avoids WebView CORS and compressed-length drift.
     */
    static ProbeResult probe(Context context, String value, long maximumBytes) throws Exception {
        if (maximumBytes <= 0 || maximumBytes > MAX_BYTES) throw new IllegalArgumentException("download_probe_limit_invalid");
        URL initial = requirePublicHttps(value);
        HttpURLConnection head = null;
        try {
            head = open(context, initial, "HEAD", -1, -1);
            int status = head.getResponseCode();
            long length = head.getContentLengthLong();
            if (status >= 200 && status < 300 && length > 0) {
                return checkedProbe(head.getURL(), length, maximumBytes);
            }
        } finally {
            if (head != null) head.disconnect();
        }

        HttpURLConnection range = null;
        try {
            range = open(context, initial, "GET", 0, 0);
            int status = range.getResponseCode();
            if (status != HttpURLConnection.HTTP_PARTIAL && status != HttpURLConnection.HTTP_OK) {
                throw new IllegalStateException("download_probe_http_" + status);
            }
            long length = status == HttpURLConnection.HTTP_PARTIAL
                ? parseContentRangeTotal(range.getHeaderField("Content-Range"))
                : range.getContentLengthLong();
            return checkedProbe(range.getURL(), length, maximumBytes);
        } finally {
            if (range != null) range.disconnect();
        }
    }

    static long parseContentRangeTotal(String value) {
        if (value == null) throw new IllegalStateException("download_probe_range_invalid");
        java.util.regex.Matcher matcher = java.util.regex.Pattern
            .compile("^bytes\\s+\\d+-\\d+/(\\d+)$", java.util.regex.Pattern.CASE_INSENSITIVE)
            .matcher(value.trim());
        if (!matcher.matches()) throw new IllegalStateException("download_probe_range_invalid");
        try {
            long total = Long.parseLong(matcher.group(1));
            if (total <= 0) throw new IllegalStateException("download_probe_size_invalid");
            return total;
        } catch (NumberFormatException error) {
            throw new IllegalStateException("download_probe_size_invalid", error);
        }
    }

    private static ProbeResult checkedProbe(URL finalUrl, long length, long maximumBytes) {
        if (length <= 0 || length > maximumBytes) throw new IllegalStateException("download_probe_size_invalid");
        return new ProbeResult(finalUrl.toString(), length);
    }

    private static HttpURLConnection open(Context context, URL initial, String method, long start, long end) throws Exception {
        URL current = initial;
        for (int redirects = 0; redirects <= 5; redirects++) {
            requirePublicHttps(current.toString());
            HttpURLConnection connection = (HttpURLConnection) current.openConnection(proxy(context));
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(20_000);
            connection.setReadTimeout(30_000);
            connection.setRequestMethod(method);
            connection.setRequestProperty("Accept-Encoding", "identity");
            connection.setRequestProperty("User-Agent", "Yachiyo-Claw-Android-Downloader");
            if (start >= 0) connection.setRequestProperty("Range", "bytes=" + start + "-" + end);
            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null) throw new IllegalStateException("download_redirect_invalid");
                current = requirePublicHttps(new URL(current, location).toString());
                continue;
            }
            return connection;
        }
        throw new IllegalStateException("download_redirect_limit");
    }

    static URL requirePublicHttps(String value) throws Exception {
        URL url = requireHttpsSyntax(value);
        URI uri = url.toURI();
        InetAddress[] addresses = InetAddress.getAllByName(uri.getHost());
        if (addresses.length == 0) throw new IllegalArgumentException("download_host_unresolved");
        for (InetAddress address : addresses) if (!isPublic(address)) throw new IllegalArgumentException("download_host_private");
        return url;
    }

    static URL requireHttpsSyntax(String value) throws Exception {
        URI uri = new URI(value);
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getRawUserInfo() != null || uri.getRawFragment() != null) {
            throw new IllegalArgumentException("download_url_rejected");
        }
        int port = uri.getPort();
        if (port != -1 && port != 443) throw new IllegalArgumentException("download_url_port_rejected");
        return uri.toURL();
    }

    private static boolean isPublic(InetAddress address) {
        if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress()
            || address.isSiteLocalAddress() || address.isMulticastAddress()) return false;
        byte[] bytes = address.getAddress();
        if (address instanceof Inet4Address) {
            int a = bytes[0] & 255, b = bytes[1] & 255, c = bytes[2] & 255;
            return a != 0 && a != 10 && a != 127 && a < 224
                && !(a == 100 && b >= 64 && b <= 127)
                && !(a == 169 && b == 254)
                && !(a == 172 && b >= 16 && b <= 31)
                && !(a == 192 && b == 168)
                && !(a == 192 && b == 0 && (c == 0 || c == 2))
                && !(a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
                && !(a == 203 && b == 0 && c == 113);
        }
        if (address instanceof Inet6Address) {
            int first = bytes[0] & 255;
            if ((first & 0xfe) == 0xfc) return false;
            return !(bytes[0] == 0x20 && bytes[1] == 0x01 && bytes[2] == 0x0d && (bytes[3] & 255) == 0xb8);
        }
        return false;
    }

    private static Proxy proxy(Context context) {
        try {
            String value = YachiyoDownloadSettingsPlugin.proxy(context);
            if (value == null || value.isBlank()) return Proxy.NO_PROXY;
            URL url = new URL(value);
            int port = url.getPort() > 0 ? url.getPort() : ("https".equalsIgnoreCase(url.getProtocol()) ? 443 : 80);
            return new Proxy(Proxy.Type.HTTP, new InetSocketAddress(url.getHost(), port));
        } catch (Exception ignored) { return Proxy.NO_PROXY; }
    }

    private static String safe(Exception error) {
        String value = error.getMessage();
        return value != null && value.matches("[A-Za-z0-9._-]{1,120}") ? value : "download_failed";
    }

    record ProbeResult(String url, long size) {}
}
