package io.github.yachiyoclaw.plugin;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import javax.net.ssl.SNIHostName;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

/** Minimal HTTP/1.1 client that connects only to the public addresses approved by the DNS policy. */
final class PinnedHttpsClient {
    private static final int MAX_STATUS_LINE = 8 * 1024;
    private static final int MAX_HEADER_LINE = 16 * 1024;
    private static final int MAX_HEADER_BYTES = 64 * 1024;

    interface SocketController {
        void requireActive();
        void attach(Socket socket) throws Exception;
        void detach(Socket socket);
    }

    static final class Response {
        final int status;
        final Map<String, String> headers;
        final byte[] body;
        final boolean truncated;

        Response(int status, Map<String, String> headers, byte[] body, boolean truncated) {
            this.status = status;
            this.headers = Collections.unmodifiableMap(headers);
            this.body = body;
            this.truncated = truncated;
        }

        String header(String name) {
            return headers.get(name.toLowerCase(Locale.ROOT));
        }
    }

    private PinnedHttpsClient() {}

    static Response execute(
        PluginNetworkPolicy.ResolvedUri target,
        String method,
        Map<String, String> headers,
        byte[] body,
        int maxResponseBytes,
        SocketController controller
    ) throws Exception {
        Exception lastError = null;
        for (InetAddress address : target.addresses) {
            controller.requireActive();
            try {
                return executeAtAddress(target.uri, address, method, headers, body, maxResponseBytes, controller);
            } catch (Exception error) {
                lastError = error;
                controller.requireActive();
            }
        }
        if (lastError != null) throw lastError;
        throw new IOException("plugin_network_connect_failed");
    }

    private static Response executeAtAddress(
        URI uri,
        InetAddress address,
        String method,
        Map<String, String> headers,
        byte[] body,
        int maxResponseBytes,
        SocketController controller
    ) throws Exception {
        int port = uri.getPort() < 0 ? 443 : uri.getPort();
        Socket raw = new Socket();
        SSLSocket tls = null;
        controller.attach(raw);
        try {
            raw.connect(new InetSocketAddress(address, port), 15_000);
            raw.setSoTimeout(15_000);
            SSLSocketFactory factory = (SSLSocketFactory) SSLSocketFactory.getDefault();
            tls = (SSLSocket) factory.createSocket(raw, uri.getHost(), port, true);
            SSLParameters parameters = tls.getSSLParameters();
            parameters.setEndpointIdentificationAlgorithm("HTTPS");
            parameters.setServerNames(List.of(new SNIHostName(uri.getHost())));
            tls.setSSLParameters(parameters);
            tls.setSoTimeout(15_000);
            controller.attach(tls);
            tls.startHandshake();
            controller.requireActive();
            writeRequest(tls.getOutputStream(), uri, method, headers, body);
            return readResponse(tls.getInputStream(), method, maxResponseBytes);
        } finally {
            Socket attached = tls == null ? raw : tls;
            controller.detach(attached);
            try {
                attached.close();
            } catch (IOException ignored) {
                // The cancellation path may already have closed it.
            }
            if (attached != raw) {
                try {
                    raw.close();
                } catch (IOException ignored) {}
            }
        }
    }

    private static void writeRequest(
        OutputStream output,
        URI uri,
        String method,
        Map<String, String> headers,
        byte[] body
    ) throws IOException {
        String path = uri.getRawPath();
        if (path == null || path.isEmpty()) path = "/";
        if (uri.getRawQuery() != null) path += "?" + uri.getRawQuery();
        String host = uri.getHost() + (uri.getPort() >= 0 && uri.getPort() != 443 ? ":" + uri.getPort() : "");
        StringBuilder request = new StringBuilder()
            .append(method).append(' ').append(path).append(" HTTP/1.1\r\n")
            .append("Host: ").append(host).append("\r\n")
            .append("Connection: close\r\n")
            .append("Accept-Encoding: identity\r\n")
            .append("User-Agent: Yachiyo-Claw-Plugin-Proxy/1\r\n");
        for (Map.Entry<String, String> header : headers.entrySet()) {
            request.append(header.getKey()).append(": ").append(header.getValue()).append("\r\n");
        }
        if (body.length > 0) request.append("Content-Length: ").append(body.length).append("\r\n");
        request.append("\r\n");
        output.write(request.toString().getBytes(StandardCharsets.ISO_8859_1));
        if (body.length > 0) output.write(body);
        output.flush();
    }

    static Response readResponse(InputStream rawInput, String method, int maxResponseBytes) throws Exception {
        BufferedInputStream input = new BufferedInputStream(rawInput);
        String statusLine = readLine(input, MAX_STATUS_LINE);
        String[] statusParts = statusLine.split(" ", 3);
        if (statusParts.length < 2 || !statusParts[0].matches("HTTP/1\\.[01]") || !statusParts[1].matches("[0-9]{3}")) {
            throw new IOException("plugin_network_response_invalid");
        }
        int status = Integer.parseInt(statusParts[1]);
        Map<String, String> headers = new LinkedHashMap<>();
        int headerBytes = statusLine.length();
        while (true) {
            String line = readLine(input, MAX_HEADER_LINE);
            headerBytes += line.length() + 2;
            if (headerBytes > MAX_HEADER_BYTES) throw new IOException("plugin_network_response_headers_too_large");
            if (line.isEmpty()) break;
            if (Character.isWhitespace(line.charAt(0))) throw new IOException("plugin_network_response_header_invalid");
            int separator = line.indexOf(':');
            if (separator <= 0) throw new IOException("plugin_network_response_header_invalid");
            String name = line.substring(0, separator).trim().toLowerCase(Locale.ROOT);
            String value = line.substring(separator + 1).trim();
            if (!name.matches("[a-z0-9!#$%&'*+.^_`|~-]{1,120}")) {
                throw new IOException("plugin_network_response_header_invalid");
            }
            headers.putIfAbsent(name, value);
        }

        if ("HEAD".equals(method) || status == 204 || status == 304 || (status >= 100 && status < 200)) {
            return new Response(status, headers, new byte[0], false);
        }
        String transferEncoding = headers.get("transfer-encoding");
        if (transferEncoding != null && transferEncoding.toLowerCase(Locale.ROOT).contains("chunked")) {
            return readChunked(input, status, headers, maxResponseBytes);
        }
        long contentLength = parseContentLength(headers.get("content-length"));
        return readBody(input, status, headers, maxResponseBytes, contentLength);
    }

    private static Response readChunked(
        BufferedInputStream input,
        int status,
        Map<String, String> headers,
        int limit
    ) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        boolean truncated = false;
        while (true) {
            String sizeLine = readLine(input, 128);
            int extension = sizeLine.indexOf(';');
            String sizeValue = (extension < 0 ? sizeLine : sizeLine.substring(0, extension)).trim();
            long size;
            try {
                size = Long.parseLong(sizeValue, 16);
            } catch (NumberFormatException error) {
                throw new IOException("plugin_network_chunk_invalid", error);
            }
            if (size < 0 || size > Integer.MAX_VALUE) throw new IOException("plugin_network_chunk_invalid");
            if (size == 0) break;
            int remaining = Math.max(0, limit - output.size());
            int retained = (int) Math.min(size, remaining);
            copyExactly(input, output, retained);
            skipExactly(input, size - retained);
            if (retained < size) truncated = true;
            expectCrlf(input);
        }
        // Trailer fields are ignored but still bounded and parsed to the terminating blank line.
        int trailerBytes = 0;
        while (true) {
            String trailer = readLine(input, MAX_HEADER_LINE);
            trailerBytes += trailer.length() + 2;
            if (trailerBytes > MAX_HEADER_BYTES) throw new IOException("plugin_network_response_headers_too_large");
            if (trailer.isEmpty()) break;
        }
        return new Response(status, headers, output.toByteArray(), truncated);
    }

    private static Response readBody(
        InputStream input,
        int status,
        Map<String, String> headers,
        int limit,
        long contentLength
    ) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[16 * 1024];
        boolean truncated = contentLength > limit;
        long remaining = contentLength >= 0 ? contentLength : Long.MAX_VALUE;
        while (remaining > 0) {
            int read = input.read(buffer, 0, (int) Math.min(buffer.length, remaining));
            if (read < 0) {
                if (contentLength >= 0) throw new EOFException("plugin_network_response_truncated");
                break;
            }
            remaining -= read;
            int retained = Math.min(read, Math.max(0, limit - output.size()));
            if (retained > 0) output.write(buffer, 0, retained);
            if (retained < read) truncated = true;
        }
        return new Response(status, headers, output.toByteArray(), truncated);
    }

    private static long parseContentLength(String value) throws IOException {
        if (value == null) return -1;
        try {
            long parsed = Long.parseLong(value);
            if (parsed < 0) throw new NumberFormatException();
            return parsed;
        } catch (NumberFormatException error) {
            throw new IOException("plugin_network_content_length_invalid", error);
        }
    }

    private static String readLine(InputStream input, int limit) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        int previous = -1;
        while (output.size() <= limit) {
            int current = input.read();
            if (current < 0) throw new EOFException("plugin_network_response_truncated");
            if (previous == '\r' && current == '\n') {
                byte[] bytes = output.toByteArray();
                return new String(bytes, 0, Math.max(0, bytes.length - 1), StandardCharsets.ISO_8859_1);
            }
            output.write(current);
            previous = current;
        }
        throw new IOException("plugin_network_response_line_too_large");
    }

    private static void copyExactly(InputStream input, OutputStream output, int amount) throws IOException {
        byte[] buffer = new byte[16 * 1024];
        int remaining = amount;
        while (remaining > 0) {
            int read = input.read(buffer, 0, Math.min(buffer.length, remaining));
            if (read < 0) throw new EOFException("plugin_network_response_truncated");
            output.write(buffer, 0, read);
            remaining -= read;
        }
    }

    private static void skipExactly(InputStream input, long amount) throws IOException {
        long remaining = amount;
        byte[] buffer = new byte[16 * 1024];
        while (remaining > 0) {
            int read = input.read(buffer, 0, (int) Math.min(buffer.length, remaining));
            if (read < 0) throw new EOFException("plugin_network_response_truncated");
            remaining -= read;
        }
    }

    private static void expectCrlf(InputStream input) throws IOException {
        if (input.read() != '\r' || input.read() != '\n') throw new IOException("plugin_network_chunk_invalid");
    }
}
