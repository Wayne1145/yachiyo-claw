package io.github.yachiyoclaw.plugin;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Main-process HTTP proxy; plugin Workers never receive the Capacitor bridge itself. */
@CapacitorPlugin(name = "YachiyoPluginNetwork")
public final class YachiyoPluginNetworkPlugin extends Plugin {
    private static final int MAX_BODY = 256 * 1024;
    private static final int MAX_RESPONSE = 512 * 1024;
    private static final int MAX_URL_CHARS = 8 * 1024;
    private static final int MAX_HEADER_BYTES = 32 * 1024;
    private static final int MAX_REDIRECTS = 5;
    private static final Set<String> METHODS = Set.of("GET", "POST", "PUT", "DELETE", "HEAD");
    private static final Set<String> HEADERS = Set.of("content-type", "accept", "authorization", "x-api-key");
    private static final Set<Integer> REDIRECTS = Set.of(301, 302, 303, 307, 308);
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final ConcurrentHashMap<String, ActiveRequest> activeRequests = new ConcurrentHashMap<>();

    @PluginMethod
    public void fetch(PluginCall call) {
        String requestId = call.getString("requestId", "");
        if (!requestId.matches("[A-Za-z0-9._:-]{1,96}")) {
            call.reject("plugin_network_request_id_invalid");
            return;
        }
        ActiveRequest request = new ActiveRequest();
        if (activeRequests.putIfAbsent(requestId, request) != null) {
            call.reject("plugin_network_request_id_duplicate");
            return;
        }
        executor.execute(() -> performFetch(call, requestId, request));
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String requestId = call.getString("requestId", "");
        ActiveRequest request = activeRequests.get(requestId);
        if (request != null) request.cancel();
        call.resolve(new JSObject().put("cancelled", request != null));
    }

    private void performFetch(PluginCall call, String requestId, ActiveRequest request) {
        try {
            String url = call.getString("url", "");
            String method = call.getString("method", "GET").toUpperCase(Locale.ROOT);
            String body = call.getString("body");
            if (!METHODS.contains(method)) throw new IllegalArgumentException("plugin_network_method_denied");
            if (url.length() > MAX_URL_CHARS) throw new IllegalArgumentException("plugin_network_url_too_large");
            if (body != null && body.getBytes(StandardCharsets.UTF_8).length > MAX_BODY) {
                throw new IllegalArgumentException("plugin_network_body_too_large");
            }
            List<String> domains = strings(call.getArray("allowedDomains", new JSArray()));
            JSObject headers = call.getObject("headers", new JSObject());
            String current = url;
            for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
                request.requireActive();
                if (current.length() > MAX_URL_CHARS) throw new IllegalArgumentException("plugin_network_url_too_large");
                PluginNetworkPolicy.ResolvedUri checked = PluginNetworkPolicy.resolveAllowedPublicHttps(current, domains);
                String hopMethod = hop == 0 ? method : "GET";
                Map<String, String> hopHeaders = hop == 0 ? collectHeaders(headers) : Collections.emptyMap();
                byte[] hopBody = hop == 0 && body != null ? body.getBytes(StandardCharsets.UTF_8) : new byte[0];
                PinnedHttpsClient.Response response = PinnedHttpsClient.execute(
                    checked,
                    hopMethod,
                    hopHeaders,
                    hopBody,
                    MAX_RESPONSE,
                    request
                );
                request.requireActive();
                if (REDIRECTS.contains(response.status)) {
                    String location = response.header("location");
                    if (location == null || location.isBlank()) throw new IllegalStateException("plugin_network_redirect_missing");
                    current = checked.uri.resolve(location).toString();
                    continue;
                }
                String contentType = response.header("content-type");
                call.resolve(new JSObject()
                    .put("status", response.status)
                    .put("contentType", contentType == null ? "" : contentType)
                    .put("body", new String(response.body, StandardCharsets.UTF_8))
                    .put("truncated", response.truncated)
                    .put("finalUrl", current));
                return;
            }
            throw new IllegalStateException("plugin_network_too_many_redirects");
        } catch (Exception error) {
            call.reject(safe(error));
        } finally {
            activeRequests.remove(requestId, request);
            request.cancel();
        }
    }

    @Override
    protected void handleOnDestroy() {
        for (ActiveRequest request : activeRequests.values()) request.cancel();
        activeRequests.clear();
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    private static Map<String, String> collectHeaders(JSObject headers) throws Exception {
        Map<String, String> allowedHeaders = new LinkedHashMap<>();
        int totalBytes = 0;
        java.util.Iterator<String> names = headers.keys();
        while (names.hasNext()) {
            String name = names.next();
            String normalized = name.toLowerCase(Locale.ROOT);
            Object raw = headers.get(name);
            if (!HEADERS.contains(normalized) || !(raw instanceof String)) continue;
            String value = (String) raw;
            if (value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0) {
                throw new IllegalArgumentException("plugin_network_header_invalid");
            }
            totalBytes += (normalized + ":" + value).getBytes(StandardCharsets.UTF_8).length;
            if (totalBytes > MAX_HEADER_BYTES) throw new IllegalArgumentException("plugin_network_headers_too_large");
            allowedHeaders.put(normalized, value);
        }
        return allowedHeaders;
    }

    private static List<String> strings(JSArray array) throws Exception {
        List<String> result = new ArrayList<>();
        for (int index = 0; index < array.length(); index++) result.add(array.getString(index));
        return result;
    }

    private static String safe(Exception error) {
        String message = error.getMessage();
        return message != null && message.matches("[A-Za-z0-9._:-]{1,120}") ? message : "plugin_network_failed";
    }

    private static final class ActiveRequest implements PinnedHttpsClient.SocketController {
        private boolean cancelled;
        private Socket socket;

        @Override
        public synchronized void attach(Socket next) throws Exception {
            if (cancelled) {
                next.close();
                throw new IllegalStateException("plugin_network_cancelled");
            }
            socket = next;
        }

        @Override
        public synchronized void detach(Socket current) {
            if (socket == current) socket = null;
        }

        @Override
        public synchronized void requireActive() {
            if (cancelled || Thread.currentThread().isInterrupted()) {
                throw new IllegalStateException("plugin_network_cancelled");
            }
        }

        synchronized void cancel() {
            cancelled = true;
            if (socket != null) {
                try {
                    socket.close();
                } catch (Exception ignored) {}
            }
            socket = null;
        }
    }
}
