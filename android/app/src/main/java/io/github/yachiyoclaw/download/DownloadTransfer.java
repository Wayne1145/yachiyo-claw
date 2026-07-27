package io.github.yachiyoclaw.download;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicLongArray;
import java.util.concurrent.locks.ReentrantLock;

/**
 * Shared ranged transfer engine. URL and redirect validation remain owned by each caller.
 * The engine is intentionally free of Android {@code Context}: the desired thread count is passed
 * in so the core is unit-testable against a plain local HTTP server.
 */
public final class DownloadTransfer {
    private static final int BUFFER = 256 * 1024;
    private static final int PLAN_SCHEMA = 1;
    private static final String PLAN_FILE = "plan.properties";
    private static final String PLAN_TEMP_FILE = "plan.properties.tmp";
    static final long MIN_SEGMENT = 4L * 1024L * 1024L;
    /**
     * App-wide cap on segment transfers that are actively streaming at once, so several download
     * tasks cannot each open {@code maxThreads} sockets and starve the network. Each segment holds
     * exactly one permit only while it streams, so a task never deadlocks waiting on itself.
     */
    private static final Semaphore GLOBAL_SEGMENTS = new Semaphore(64, true);
    private static final ConcurrentHashMap<String, ReentrantLock> TARGET_LOCKS = new ConcurrentHashMap<>();

    public interface ConnectionFactory { HttpURLConnection open(long start, long end) throws Exception; }
    public interface ProgressListener { void onProgress(long transferred, long total, long bytesPerSecond) throws Exception; }
    public interface StopSignal { boolean stopped(); }

    private DownloadTransfer() {}

    /** Parallel segment count for a size given the caller's desired thread count. Pure and testable. */
    static int planSegments(long expectedSize, int maxThreads, long minSegment) {
        int desired = Math.max(1, Math.min(64, maxThreads));
        int bySize = (int) Math.max(1L, expectedSize / Math.max(1L, minSegment));
        return Math.max(1, Math.min(desired, bySize));
    }

    public static void download(
        File target,
        long expectedSize,
        String expectedSha256,
        int maxThreads,
        ConnectionFactory connections,
        ProgressListener progress,
        StopSignal stop
    ) throws Exception {
        download(target, expectedSize, expectedSha256, maxThreads, 0, MIN_SEGMENT, connections, progress, stop);
    }

    /** Production entrypoint with the user's configured retry count. */
    public static void download(
        File target,
        long expectedSize,
        String expectedSha256,
        int maxThreads,
        int maxRetries,
        ConnectionFactory connections,
        ProgressListener progress,
        StopSignal stop
    ) throws Exception {
        download(target, expectedSize, expectedSha256, maxThreads, maxRetries, MIN_SEGMENT, connections, progress, stop);
    }

    // Package-private overload lets unit tests force multiple segments on small fixtures.
    static void download(
        File target,
        long expectedSize,
        String expectedSha256,
        int maxThreads,
        long minSegment,
        ConnectionFactory connections,
        ProgressListener progress,
        StopSignal stop
    ) throws Exception {
        download(target, expectedSize, expectedSha256, maxThreads, 0, minSegment, connections, progress, stop);
    }

    // Package-private overload lets tests exercise retry behavior without multi-megabyte fixtures.
    static void download(
        File target,
        long expectedSize,
        String expectedSha256,
        int maxThreads,
        int maxRetries,
        long minSegment,
        ConnectionFactory connections,
        ProgressListener progress,
        StopSignal stop
    ) throws Exception {
        String targetKey = target.getCanonicalPath();
        ReentrantLock targetLock = TARGET_LOCKS.computeIfAbsent(targetKey, ignored -> new ReentrantLock(true));
        targetLock.lockInterruptibly();
        try {
            downloadLocked(target, expectedSize, expectedSha256, maxThreads, maxRetries, minSegment, connections, progress, stop);
        } finally {
            targetLock.unlock();
        }
    }

    private static void downloadLocked(
        File target,
        long expectedSize,
        String expectedSha256,
        int maxThreads,
        int maxRetries,
        long minSegment,
        ConnectionFactory connections,
        ProgressListener progress,
        StopSignal stop
    ) throws Exception {
        if (expectedSize <= 0) throw new IllegalArgumentException("download_size_required");
        File parent = target.getParentFile();
        if (parent != null) parent.mkdirs();
        if (target.isFile() && target.length() == expectedSize && verify(target, expectedSha256)) {
            progress.onProgress(expectedSize, expectedSize, 0);
            return;
        }
        int segments = planSegments(expectedSize, maxThreads, minSegment);
        if (segments > 1) {
            if (!supportsRanges(connections, expectedSize, Math.max(0, Math.min(16, maxRetries)), stop)) segments = 1;
        }
        final int segmentCount = segments;
        File segmentDirectory = new File(target.getPath() + ".segments");
        prepareSegmentDirectory(segmentDirectory, expectedSize, segmentCount);
        long[] initialLengths = existingSegmentLengths(segmentDirectory, segmentCount, expectedSize);
        AtomicLongArray accountedLengths = new AtomicLongArray(initialLengths);
        AtomicLong transferred = new AtomicLong(sum(initialLengths));
        AtomicLong lastBytes = new AtomicLong(transferred.get());
        AtomicLong lastAt = new AtomicLong(System.currentTimeMillis());
        reportProgress(progress, transferred.get(), expectedSize, 0);
        ExecutorService executor = Executors.newFixedThreadPool(segmentCount);
        List<Future<Void>> futures = new ArrayList<>();
        try {
            for (int index = 0; index < segmentCount; index++) {
                final int segment = index;
                futures.add(executor.submit((Callable<Void>) () -> transferSegment(
                    segment, segmentCount, expectedSize, segmentDirectory, connections, progress, stop,
                    transferred, accountedLengths, lastBytes, lastAt, Math.max(0, Math.min(16, maxRetries)))));
            }
            for (Future<Void> future : futures) {
                try {
                    future.get();
                } catch (ExecutionException error) {
                    Throwable cause = error.getCause();
                    throw cause instanceof Exception ? (Exception) cause : error;
                }
            }
        } finally {
            for (Future<Void> future : futures) if (!future.isDone()) future.cancel(true);
            executor.shutdownNow();
        }
        try {
            mergeAndVerify(target, segmentDirectory, segmentCount, expectedSize, expectedSha256);
        } catch (SecurityException integrity) {
            // Corrupt content will just re-fail on resume; drop the segments so a retry re-downloads cleanly.
            deleteRecursively(segmentDirectory);
            throw integrity;
        }
        deleteRecursively(segmentDirectory);
        reportProgress(progress, expectedSize, expectedSize, 0);
    }

    private static Void transferSegment(
        int segment,
        int segmentCount,
        long expectedSize,
        File segmentDirectory,
        ConnectionFactory connections,
        ProgressListener progress,
        StopSignal stop,
        AtomicLong transferred,
        AtomicLongArray accountedLengths,
        AtomicLong lastBytes,
        AtomicLong lastAt,
        int maxRetries
    ) throws Exception {
        int attempt = 0;
        while (true) {
            try {
                return transferSegmentOnce(
                    segment, segmentCount, expectedSize, segmentDirectory, connections, progress, stop,
                    transferred, accountedLengths, lastBytes, lastAt);
            } catch (Exception error) {
                if (!isRetryable(error, attempt, maxRetries, stop)) throw error;
                attempt++;
                Thread.sleep(Math.min(4_000L, 250L << Math.min(attempt - 1, 4)));
            }
        }
    }

    private static Void transferSegmentOnce(
        int segment,
        int segmentCount,
        long expectedSize,
        File segmentDirectory,
        ConnectionFactory connections,
        ProgressListener progress,
        StopSignal stop,
        AtomicLong transferred,
        AtomicLongArray accountedLengths,
        AtomicLong lastBytes,
        AtomicLong lastAt
    ) throws Exception {
        long baseStart = expectedSize * segment / segmentCount;
        long end = expectedSize * (segment + 1) / segmentCount - 1;
        File part = new File(segmentDirectory, String.format("%03d.part", segment));
        long expected = end - baseStart + 1;
        long existing = part.isFile() ? part.length() : 0;
        if (existing > expected) {
            if (!part.delete()) throw new IllegalStateException("download_segment_reset_failed");
            existing = 0;
        }
        reconcileProgress(segment, existing, transferred, accountedLengths);
        if (existing == expected) return null;
        if (stop.stopped()) throw new InterruptedException("download_paused");
        GLOBAL_SEGMENTS.acquire();
        try {
            long start = baseStart + existing;
            boolean append = existing > 0;
            HttpURLConnection connection = connections.open(start, end);
            try {
                int status = connection.getResponseCode();
                if (segmentCount == 1 && status == HttpURLConnection.HTTP_OK) {
                    // Server ignored Range and is streaming the whole file: restart the sole segment from 0.
                    long contentLength = connection.getContentLengthLong();
                    if (contentLength >= 0 && contentLength != expectedSize) throw new IllegalStateException("download_size_mismatch");
                    if (append) {
                        reconcileProgress(segment, 0, transferred, accountedLengths);
                        append = false;
                    }
                } else if (status != HttpURLConnection.HTTP_PARTIAL) {
                    throw new IllegalStateException(status == HttpURLConnection.HTTP_OK ? "download_range_unsupported" : "download_http_" + status);
                } else {
                    validatePartialResponse(connection, start, end, expectedSize);
                }
                try (BufferedInputStream input = new BufferedInputStream(connection.getInputStream(), BUFFER);
                     FileOutputStream output = new FileOutputStream(part, append)) {
                    byte[] buffer = new byte[BUFFER];
                    int read;
                    while ((read = input.read(buffer)) >= 0) {
                        if (stop.stopped()) throw new InterruptedException("download_paused");
                        if (read == 0) continue;
                        output.write(buffer, 0, read);
                        accountedLengths.addAndGet(segment, read);
                        long current = transferred.addAndGet(read);
                        long now = System.currentTimeMillis();
                        long previousAt = lastAt.get();
                        if (now - previousAt >= 500 && lastAt.compareAndSet(previousAt, now)) {
                            long previousBytes = lastBytes.getAndSet(current);
                            reportProgress(progress, current, expectedSize, Math.max(0, (current - previousBytes) * 1000 / Math.max(1, now - previousAt)));
                        }
                    }
                    output.getFD().sync();
                }
            } finally { connection.disconnect(); }
            if (part.length() != expected) throw new IllegalStateException("download_size_mismatch");
            return null;
        } finally {
            GLOBAL_SEGMENTS.release();
        }
    }

    private static boolean isRetryable(Exception error, int attempt, int maxRetries, StopSignal stop) {
        if (attempt >= maxRetries || stop.stopped() || error instanceof InterruptedException || error instanceof SecurityException) {
            return false;
        }
        String message = error.getMessage();
        if (message == null) return error instanceof java.io.IOException;
        if (message.equals("download_range_unsupported") || message.equals("download_range_mismatch")
            || message.equals("download_paused") || message.startsWith("download_segment_")) {
            return false;
        }
        if (message.startsWith("download_http_")) {
            try {
                int status = Integer.parseInt(message.substring("download_http_".length()));
                return status == 408 || status == 425 || status == 429 || status >= 500;
            } catch (NumberFormatException ignored) {
                return false;
            }
        }
        return true;
    }

    private static boolean supportsRanges(ConnectionFactory connections, long expectedSize, int maxRetries, StopSignal stop) throws Exception {
        int attempt = 0;
        while (true) {
            if (stop.stopped()) throw new InterruptedException("download_paused");
            HttpURLConnection probe = connections.open(0, 0);
            try {
                int status = probe.getResponseCode();
                if (status == HttpURLConnection.HTTP_PARTIAL) {
                    validatePartialResponse(probe, 0, 0, expectedSize);
                    return true;
                }
                if (status == HttpURLConnection.HTTP_OK) return false;
                throw new IllegalStateException("download_http_" + status);
            } catch (Exception error) {
                if (!isRetryable(error, attempt, maxRetries, stop)) throw error;
                attempt++;
                Thread.sleep(Math.min(4_000L, 250L << Math.min(attempt - 1, 4)));
            } finally {
                probe.disconnect();
            }
        }
    }

    private static void mergeAndVerify(File target, File segmentDirectory, int segmentCount, long expectedSize, String expectedSha256) throws Exception {
        File temporary = new File(target.getPath() + ".part");
        try (RandomAccessFile output = new RandomAccessFile(temporary, "rw")) {
            output.setLength(0);
            byte[] buffer = new byte[BUFFER];
            for (int index = 0; index < segmentCount; index++) {
                File part = new File(segmentDirectory, String.format("%03d.part", index));
                long expected = expectedSize * (index + 1) / segmentCount - expectedSize * index / segmentCount;
                if (!part.isFile() || part.length() != expected) throw new SecurityException("download_integrity_failed");
                try (FileInputStream input = new FileInputStream(part)) {
                    int read; while ((read = input.read(buffer)) >= 0) if (read > 0) output.write(buffer, 0, read);
                }
            }
            output.getFD().sync();
        }
        if (temporary.length() != expectedSize || !verify(temporary, expectedSha256)) {
            temporary.delete();
            throw new SecurityException("download_integrity_failed");
        }
        Files.move(temporary.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING);
    }

    private static long[] existingSegmentLengths(File directory, int segments, long size) {
        long[] lengths = new long[segments];
        for (int index = 0; index < segments; index++) {
            long expected = size * (index + 1) / segments - size * index / segments;
            File part = new File(directory, String.format("%03d.part", index));
            lengths[index] = Math.min(expected, part.isFile() ? Math.max(0, part.length()) : 0);
        }
        return lengths;
    }

    /** Best-effort byte count for displaying progress after a worker was stopped or restarted. */
    public static long resumableBytes(File target, long expectedSize) {
        File directory = new File(target.getPath() + ".segments");
        SegmentPlan plan = readSegmentPlan(directory);
        if (plan == null || plan.expectedSize != expectedSize || !validFragmentLayout(directory, plan.segments, expectedSize)) {
            return target.isFile() ? clamp(target.length(), 0, expectedSize) : 0;
        }
        return clamp(sum(existingSegmentLengths(directory, plan.segments, expectedSize)), 0, expectedSize);
    }

    /** Removes a published file and every resumable fragment for an explicit user cancellation. */
    public static void discard(File target) {
        deleteRecursively(new File(target.getPath() + ".segments"));
        deleteRecursively(new File(target.getPath() + ".part"));
        deleteRecursively(target);
    }

    public static boolean verify(File file, String expected) throws Exception {
        if (expected == null || expected.isBlank()) return true;
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (DigestInputStream input = new DigestInputStream(new FileInputStream(file), digest)) {
            byte[] buffer = new byte[BUFFER]; while (input.read(buffer) >= 0) {}
        }
        return MessageDigest.isEqual(hex(digest.digest()).getBytes(java.nio.charset.StandardCharsets.US_ASCII), expected.toLowerCase().getBytes(java.nio.charset.StandardCharsets.US_ASCII));
    }

    private static String hex(byte[] bytes) { StringBuilder result = new StringBuilder(); for (byte value : bytes) result.append(String.format("%02x", value)); return result.toString(); }
    private static void deleteRecursively(File file) { if (file.isDirectory()) { File[] children = file.listFiles(); if (children != null) for (File child : children) deleteRecursively(child); } file.delete(); }

    private static void prepareSegmentDirectory(File directory, long expectedSize, int segments) throws Exception {
        SegmentPlan stored = readSegmentPlan(directory);
        boolean reusable = stored != null
            && stored.expectedSize == expectedSize
            && stored.segments == segments
            && validFragmentLayout(directory, segments, expectedSize);
        if (!reusable && stored == null) reusable = validLegacySingleSegment(directory, segments, expectedSize);
        if (!reusable && directory.exists()) deleteRecursively(directory);
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("download_segment_storage_unavailable");
        writeSegmentPlan(directory, expectedSize, segments);
    }

    private static boolean validLegacySingleSegment(File directory, int segments, long expectedSize) {
        if (!directory.isDirectory() || segments != 1) return false;
        File[] parts = directory.listFiles((ignored, name) -> name.endsWith(".part"));
        return parts != null && parts.length == 1 && "000.part".equals(parts[0].getName()) && parts[0].length() <= expectedSize;
    }

    private static boolean validFragmentLayout(File directory, int segments, long expectedSize) {
        if (!directory.isDirectory() || segments < 1 || segments > 64) return false;
        File[] parts = directory.listFiles((ignored, name) -> name.endsWith(".part"));
        if (parts == null) return false;
        for (File part : parts) {
            String name = part.getName();
            if (!name.matches("\\d{3}\\.part")) return false;
            int index;
            try { index = Integer.parseInt(name.substring(0, 3)); }
            catch (NumberFormatException ignored) { return false; }
            if (index < 0 || index >= segments) return false;
            long expected = expectedSize * (index + 1) / segments - expectedSize * index / segments;
            if (part.length() < 0 || part.length() > expected) return false;
        }
        return true;
    }

    private static final class SegmentPlan {
        final long expectedSize;
        final int segments;
        SegmentPlan(long expectedSize, int segments) {
            this.expectedSize = expectedSize;
            this.segments = segments;
        }
    }

    private static SegmentPlan readSegmentPlan(File directory) {
        File file = new File(directory, PLAN_FILE);
        if (!file.isFile()) return null;
        Properties values = new Properties();
        try (FileInputStream input = new FileInputStream(file)) {
            values.load(input);
            if (Integer.parseInt(values.getProperty("schema", "0")) != PLAN_SCHEMA) return null;
            long expectedSize = Long.parseLong(values.getProperty("expectedSize", "0"));
            int segments = Integer.parseInt(values.getProperty("segments", "0"));
            if (expectedSize <= 0 || segments < 1 || segments > 64) return null;
            return new SegmentPlan(expectedSize, segments);
        } catch (Exception ignored) {
            return null;
        }
    }

    private static void writeSegmentPlan(File directory, long expectedSize, int segments) throws Exception {
        Properties values = new Properties();
        values.setProperty("schema", Integer.toString(PLAN_SCHEMA));
        values.setProperty("expectedSize", Long.toString(expectedSize));
        values.setProperty("segments", Integer.toString(segments));
        File temporary = new File(directory, PLAN_TEMP_FILE);
        File destination = new File(directory, PLAN_FILE);
        try (FileOutputStream output = new FileOutputStream(temporary, false)) {
            values.store(output, "Yachiyo Claw resumable download plan");
            output.getFD().sync();
        }
        try {
            Files.move(temporary.toPath(), destination.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } catch (AtomicMoveNotSupportedException ignored) {
            Files.move(temporary.toPath(), destination.toPath(), StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private static void validatePartialResponse(HttpURLConnection connection, long start, long end, long expectedSize) {
        String value = connection.getHeaderField("Content-Range");
        String expected = "bytes " + start + "-" + end + "/" + expectedSize;
        if (value == null || !expected.equalsIgnoreCase(value.trim())) throw new IllegalStateException("download_range_mismatch");
        long contentLength = connection.getContentLengthLong();
        if (contentLength >= 0 && contentLength != end - start + 1) throw new IllegalStateException("download_range_mismatch");
    }

    private static void reconcileProgress(int segment, long actualLength, AtomicLong transferred, AtomicLongArray accountedLengths) {
        long previous = accountedLengths.getAndSet(segment, actualLength);
        if (previous != actualLength) transferred.addAndGet(actualLength - previous);
    }

    private static void reportProgress(ProgressListener progress, long transferred, long total, long bytesPerSecond) throws Exception {
        progress.onProgress(clamp(transferred, 0, total), Math.max(0, total), Math.max(0, bytesPerSecond));
    }

    private static long sum(long[] values) {
        long total = 0;
        for (long value : values) total += Math.max(0, value);
        return total;
    }

    private static long clamp(long value, long minimum, long maximum) {
        return Math.max(minimum, Math.min(Math.max(minimum, maximum), value));
    }
}
