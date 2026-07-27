package io.github.yachiyoclaw.download;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Properties;
import java.util.Random;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/**
 * Exercises the shared ranged transfer engine against a real local HTTP server:
 * segment planning, 206 concurrency, resume of partial segments, 200 fallback,
 * integrity/size mismatch handling, and cancel-then-resume.
 */
public class DownloadTransferTest {
    @Rule public TemporaryFolder folder = new TemporaryFolder();

    private RangeServer server;
    private byte[] payload;
    private String sha;

    private final DownloadTransfer.ProgressListener noProgress = (a, b, c) -> {};
    private final DownloadTransfer.StopSignal noStop = () -> false;

    @Before public void setUp() throws Exception {
        payload = new byte[1_000_000];
        new Random(42).nextBytes(payload);
        sha = sha256(payload);
        server = new RangeServer(payload);
    }

    @After public void tearDown() { if (server != null) server.stop(); }

    private DownloadTransfer.ConnectionFactory factory() {
        return (start, end) -> {
            HttpURLConnection c = (HttpURLConnection) new URL(server.url).openConnection();
            c.setConnectTimeout(5000);
            c.setReadTimeout(5000);
            if (start >= 0) c.setRequestProperty("Range", "bytes=" + start + "-" + end);
            return c;
        };
    }

    // --- segment planning (pure) ---

    @Test public void planSegmentsRespectsBoundsAndSize() {
        assertEquals(1, DownloadTransfer.planSegments(1000, 8, DownloadTransfer.MIN_SEGMENT)); // tiny file -> 1
        assertEquals(1, DownloadTransfer.planSegments(1_000_000, 1, 100_000));                 // 1 thread
        assertEquals(8, DownloadTransfer.planSegments(1_000_000, 8, 100_000));                 // size allows 10, capped by threads
        assertEquals(10, DownloadTransfer.planSegments(1_000_000, 64, 100_000));               // capped by size (10)
        assertEquals(64, DownloadTransfer.planSegments(1_000_000, 64, 10_000));                // capped by 64
        assertEquals(64, DownloadTransfer.planSegments(10_000_000, 999, 10_000));              // hard 64 ceiling
        assertEquals(1, DownloadTransfer.planSegments(1_000_000, 0, 100_000));                 // clamp <1 -> 1
    }

    // --- happy paths across thread counts ---

    @Test public void multiSegmentDownloadSucceeds() throws Exception {
        File target = new File(folder.getRoot(), "multi.bin");
        DownloadTransfer.download(target, payload.length, sha, 8, 100_000, factory(), noProgress, noStop);
        assertArrayEquals(payload, Files.readAllBytes(target.toPath()));
        assertFalse(new File(target.getPath() + ".segments").exists());
    }

    @Test public void singleThreadDownloadSucceeds() throws Exception {
        File target = new File(folder.getRoot(), "single.bin");
        DownloadTransfer.download(target, payload.length, sha, 1, DownloadTransfer.MIN_SEGMENT, factory(), noProgress, noStop);
        assertArrayEquals(payload, Files.readAllBytes(target.toPath()));
    }

    @Test public void sixtyFourSegmentDownloadSucceeds() throws Exception {
        File target = new File(folder.getRoot(), "many.bin");
        DownloadTransfer.download(target, payload.length, sha, 64, 10_000, factory(), noProgress, noStop);
        assertArrayEquals(payload, Files.readAllBytes(target.toPath()));
    }

    // --- 200 fallback when the server ignores Range ---

    @Test public void fallsBackToSingleStreamWhenRangeUnsupported() throws Exception {
        server.supportRange = false;
        File target = new File(folder.getRoot(), "norange.bin");
        DownloadTransfer.download(target, payload.length, sha, 8, 100_000, factory(), noProgress, noStop);
        assertArrayEquals(payload, Files.readAllBytes(target.toPath()));
    }

    // --- integrity + size guards ---

    @Test public void shaMismatchFailsAndCleansUp() {
        File target = new File(folder.getRoot(), "bad-sha.bin");
        String wrong = sha.substring(0, sha.length() - 1) + (sha.endsWith("0") ? "1" : "0");
        assertThrows(SecurityException.class, () ->
            DownloadTransfer.download(target, payload.length, wrong, 8, 100_000, factory(), noProgress, noStop));
        assertFalse("verified file must not be published", target.exists());
        assertFalse("corrupt segments dropped for a clean retry", new File(target.getPath() + ".segments").exists());
        assertFalse(new File(target.getPath() + ".part").exists());
    }

    @Test public void sizeLargerThanSourceFails() {
        File target = new File(folder.getRoot(), "short.bin");
        assertThrows(Exception.class, () ->
            DownloadTransfer.download(target, payload.length + 4096, sha, 8, 100_000, factory(), noProgress, noStop));
        assertFalse(target.exists());
    }

    // --- resume behaviour ---

    @Test public void resumesFromPreexistingPartialSegments() throws Exception {
        File target = new File(folder.getRoot(), "resume.bin");
        int threads = 8;
        long minSegment = 100_000;
        int segments = DownloadTransfer.planSegments(payload.length, threads, minSegment);
        File segDir = new File(target.getPath() + ".segments");
        assertTrue(segDir.mkdirs());
        writePlan(segDir, payload.length, segments);
        // Pre-seed the first half of every segment so only the remainder should transfer.
        for (int seg = 0; seg < segments; seg++) {
            long baseStart = (long) payload.length * seg / segments;
            long end = (long) payload.length * (seg + 1) / segments - 1;
            int expected = (int) (end - baseStart + 1);
            int half = expected / 2;
            byte[] slice = new byte[half];
            System.arraycopy(payload, (int) baseStart, slice, 0, half);
            Files.write(new File(segDir, String.format("%03d.part", seg)).toPath(), slice);
        }
        server.servedBytes.set(0);
        DownloadTransfer.download(target, payload.length, sha, threads, minSegment, factory(), noProgress, noStop);
        assertArrayEquals(payload, Files.readAllBytes(target.toPath()));
        assertTrue("resume should transfer far less than the whole file",
            server.servedBytes.get() < payload.length);
    }

    @Test public void changedSegmentPlanDropsIncompatibleFragmentsWithoutSha() throws Exception {
        File target = new File(folder.getRoot(), "changed-plan.bin");
        File segDir = new File(target.getPath() + ".segments");
        assertTrue(segDir.mkdirs());
        int oldSegments = 8;
        writePlan(segDir, payload.length, oldSegments);
        for (int segment = 0; segment < oldSegments; segment++) {
            int start = payload.length * segment / oldSegments;
            int end = payload.length * (segment + 1) / oldSegments;
            byte[] slice = new byte[end - start];
            System.arraycopy(payload, start, slice, 0, slice.length);
            Files.write(new File(segDir, String.format("%03d.part", segment)).toPath(), slice);
        }

        server.servedBytes.set(0);
        DownloadTransfer.download(target, payload.length, "", 4, 100_000, factory(), noProgress, noStop);

        assertArrayEquals("new boundaries must never reuse fragments from the old plan", payload, Files.readAllBytes(target.toPath()));
        assertTrue("incompatible fragments must be rebuilt instead of accepted by length", server.servedBytes.get() >= payload.length);
    }

    @Test public void retryProgressNeverExceedsExpectedSize() throws Exception {
        File target = new File(folder.getRoot(), "retry-progress.bin");
        server.truncatedResponses.set(1);
        List<Long> reported = Collections.synchronizedList(new ArrayList<>());
        DownloadTransfer.download(
            target,
            payload.length,
            sha,
            4,
            2,
            100_000,
            factory(),
            (transferred, total, speed) -> reported.add(transferred),
            noStop
        );
        assertArrayEquals(payload, Files.readAllBytes(target.toPath()));
        assertTrue(reported.stream().allMatch(value -> value >= 0 && value <= payload.length));
        assertEquals(payload.length, (long) reported.get(reported.size() - 1));
    }

    @Test public void concurrentWorkersForSameTargetAreSerialized() throws Exception {
        File target = new File(folder.getRoot(), "same-target.bin");
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<?> first = executor.submit(() -> runDownloadAfter(start, target));
            Future<?> second = executor.submit(() -> runDownloadAfter(start, target));
            start.countDown();
            first.get(10, TimeUnit.SECONDS);
            second.get(10, TimeUnit.SECONDS);
        } finally {
            executor.shutdownNow();
        }
        assertArrayEquals(payload, Files.readAllBytes(target.toPath()));
        assertTrue("the second worker must reuse the published file instead of racing the first", server.servedBytes.get() <= payload.length + 1);
    }

    @Test public void cancelPreservesSegmentsThenResumesToCompletion() throws Exception {
        // Single large segment so the stop signal can trip mid-stream.
        payload = new byte[4_000_000];
        new Random(7).nextBytes(payload);
        sha = sha256(payload);
        server.stop();
        server = new RangeServer(payload);
        File target = new File(folder.getRoot(), "cancel.bin");

        AtomicInteger checks = new AtomicInteger();
        DownloadTransfer.StopSignal stopSoon = () -> checks.incrementAndGet() >= 4;
        assertThrows(Exception.class, () ->
            DownloadTransfer.download(target, payload.length, sha, 1, 8L * 1024 * 1024, factory(), noProgress, stopSoon));

        File segDir = new File(target.getPath() + ".segments");
        assertTrue("paused segments must be preserved for resume", segDir.isDirectory());
        File part = new File(segDir, "000.part");
        assertTrue(part.isFile());
        assertTrue("some bytes should already be on disk", part.length() > 0);
        assertTrue(part.length() < payload.length);
        assertFalse("no half-verified file should be published", target.exists());

        DownloadTransfer.download(target, payload.length, sha, 1, 8L * 1024 * 1024, factory(), noProgress, noStop);
        assertArrayEquals(payload, Files.readAllBytes(target.toPath()));
    }

    @Test public void alreadyCompleteFileIsNotRedownloaded() throws Exception {
        File target = new File(folder.getRoot(), "done.bin");
        Files.write(target.toPath(), payload);
        server.servedBytes.set(0);
        DownloadTransfer.download(target, payload.length, sha, 8, 100_000, factory(), noProgress, noStop);
        assertEquals("verified existing file must skip the network", 0, server.servedBytes.get());
        assertArrayEquals(payload, Files.readAllBytes(target.toPath()));
    }

    @Test public void retriesTransientServerFailureThenResumes() throws Exception {
        File target = new File(folder.getRoot(), "retry.bin");
        server.forcedFailures.set(1);
        DownloadTransfer.download(target, payload.length, sha, 4, 2, 100_000, factory(), noProgress, noStop);
        assertArrayEquals(payload, Files.readAllBytes(target.toPath()));
        assertTrue("the configured retry path must have been exercised", server.requests.get() > 4);
    }

    // --- helpers ---

    private static String sha256(byte[] data) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        StringBuilder result = new StringBuilder();
        for (byte b : digest.digest(data)) result.append(String.format("%02x", b));
        return result.toString();
    }

    private void runDownloadAfter(CountDownLatch start, File target) {
        try {
            start.await();
            DownloadTransfer.download(target, payload.length, sha, 4, 100_000, factory(), noProgress, noStop);
        } catch (Exception error) {
            throw new RuntimeException(error);
        }
    }

    private static void writePlan(File directory, long expectedSize, int segments) throws Exception {
        Properties values = new Properties();
        values.setProperty("schema", "1");
        values.setProperty("expectedSize", Long.toString(expectedSize));
        values.setProperty("segments", Integer.toString(segments));
        try (OutputStream output = Files.newOutputStream(new File(directory, "plan.properties").toPath())) {
            values.store(output, "test plan");
        }
    }

    /**
     * Minimal Range-aware static file server built on a raw {@link ServerSocket} so it works under the
     * Android unit-test bootclasspath (which excludes {@code com.sun.net.httpserver}).
     */
    static final class RangeServer {
        private final ServerSocket socket;
        private final byte[] payload;
        final String url;
        volatile boolean supportRange = true;
        final AtomicLong servedBytes = new AtomicLong();
        final AtomicInteger forcedFailures = new AtomicInteger();
        final AtomicInteger truncatedResponses = new AtomicInteger();
        final AtomicInteger requests = new AtomicInteger();
        private volatile boolean running = true;

        RangeServer(byte[] payload) throws IOException {
            this.payload = payload;
            socket = new ServerSocket();
            socket.setReuseAddress(true);
            socket.bind(new InetSocketAddress("127.0.0.1", 0));
            url = "http://127.0.0.1:" + socket.getLocalPort() + "/file";
            Thread acceptor = new Thread(this::acceptLoop, "range-server");
            acceptor.setDaemon(true);
            acceptor.start();
        }

        void stop() {
            running = false;
            try { socket.close(); } catch (IOException ignored) {}
        }

        private void acceptLoop() {
            while (running) {
                try {
                    Socket client = socket.accept();
                    Thread worker = new Thread(() -> handle(client));
                    worker.setDaemon(true);
                    worker.start();
                } catch (IOException e) {
                    if (!running) return;
                }
            }
        }

        private void handle(Socket client) {
            try (Socket c = client) {
                requests.incrementAndGet();
                InputStream in = c.getInputStream();
                OutputStream out = c.getOutputStream();
                if (readLine(in) == null) return; // request line
                String range = null;
                String header;
                while ((header = readLine(in)) != null && !header.isEmpty()) {
                    int idx = header.indexOf(':');
                    if (idx > 0 && header.substring(0, idx).trim().equalsIgnoreCase("Range")) range = header.substring(idx + 1).trim();
                }
                if (forcedFailures.getAndUpdate((value) -> Math.max(0, value - 1)) > 0) {
                    out.write("HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
                    out.flush();
                    return;
                }
                boolean partial = supportRange && range != null;
                int start = 0;
                int endInclusive = payload.length - 1;
                int code = 200;
                String reason = "OK";
                if (partial) {
                    long[] r = parseRange(range);
                    start = (int) Math.max(0, r[0]);
                    endInclusive = (int) Math.min(r[1], payload.length - 1);
                    code = 206;
                    reason = "Partial Content";
                }
                int len = Math.max(0, endInclusive - start + 1);
                StringBuilder head = new StringBuilder();
                head.append("HTTP/1.1 ").append(code).append(' ').append(reason).append("\r\n");
                head.append("Content-Length: ").append(len).append("\r\n");
                if (partial) head.append("Content-Range: bytes ").append(start).append('-').append(endInclusive).append('/').append(payload.length).append("\r\n");
                head.append("Accept-Ranges: bytes\r\n");
                head.append("Connection: close\r\n\r\n");
                out.write(head.toString().getBytes(StandardCharsets.US_ASCII));
                if (len > 0) {
                    boolean truncate = len > 1 && truncatedResponses.getAndUpdate((value) -> Math.max(0, value - 1)) > 0;
                    int sent = truncate ? Math.max(1, len / 2) : len;
                    out.write(payload, start, sent);
                    servedBytes.addAndGet(sent);
                }
                out.flush();
            } catch (Exception ignored) {
                // Client disconnects on cancel/probe are expected.
            }
        }

        private static String readLine(InputStream in) throws IOException {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            int ch;
            while ((ch = in.read()) != -1 && ch != '\n') buffer.write(ch);
            if (ch == -1 && buffer.size() == 0) return null;
            String line = buffer.toString("US-ASCII");
            return line.endsWith("\r") ? line.substring(0, line.length() - 1) : line;
        }

        private static long[] parseRange(String header) {
            String value = header.substring(header.indexOf('=') + 1);
            String[] parts = value.split("-", -1);
            long start = Long.parseLong(parts[0].trim());
            long end = parts.length > 1 && !parts[1].trim().isEmpty() ? Long.parseLong(parts[1].trim()) : Long.MAX_VALUE;
            return new long[]{start, end};
        }
    }
}
