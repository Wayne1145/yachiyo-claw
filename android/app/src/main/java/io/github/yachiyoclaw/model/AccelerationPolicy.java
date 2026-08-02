package io.github.yachiyoclaw.model;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/** Pure acceleration policy shared by runtime selection and host-side unit tests. */
final class AccelerationPolicy {
    static final String MODE_AUTO = "auto";
    static final String MODE_EXTREME = "extreme";
    static final String BACKEND_AUTO = "auto";
    static final String BACKEND_CPU = "cpu";
    static final String BACKEND_GPU = "gpu";
    static final String BACKEND_NPU = "npu";
    private static final long GIB = 1024L * 1024L * 1024L;

    private AccelerationPolicy() {}

    static final class Benchmark {
        final String backend;
        final double initializationMs;
        final double firstTokenMs;
        final double prefillTokensPerSecond;
        final double decodeTokensPerSecond;
        final long residentBytes;
        final String failureReason;
        double score;

        Benchmark(
            String backend,
            double initializationMs,
            double firstTokenMs,
            double prefillTokensPerSecond,
            double decodeTokensPerSecond,
            long residentBytes,
            String failureReason
        ) {
            this.backend = normalizeBackend(backend);
            this.initializationMs = finitePositive(initializationMs);
            this.firstTokenMs = finitePositive(firstTokenMs);
            this.prefillTokensPerSecond = finitePositive(prefillTokensPerSecond);
            this.decodeTokensPerSecond = finitePositive(decodeTokensPerSecond);
            this.residentBytes = Math.max(0L, residentBytes);
            this.failureReason = failureReason;
        }

        boolean succeeded() {
            return failureReason == null
                && firstTokenMs > 0
                && prefillTokensPerSecond > 0
                && decodeTokensPerSecond > 0;
        }
    }

    static final class BackendChoice {
        final String backend;
        final String fallbackReason;

        BackendChoice(String backend, String fallbackReason) {
            this.backend = backend;
            this.fallbackReason = fallbackReason;
        }
    }

    static BackendChoice selectRuntimeBackend(
        String requestedBackend,
        String calibratedBackend,
        List<String> availableBackends,
        boolean thermalSafe
    ) {
        if (availableBackends == null || availableBackends.isEmpty()) {
            throw new IllegalStateException("local_acceleration_profile_invalid");
        }
        String requested = normalizeBackend(requestedBackend);
        String calibrated = normalizeBackend(calibratedBackend);
        String preferred = BACKEND_AUTO.equals(requested) ? calibrated : requested;
        String fallbackReason = "";
        if (!availableBackends.contains(preferred)) {
            preferred = availableBackends.contains(calibrated) ? calibrated
                : availableBackends.contains(BACKEND_CPU) ? BACKEND_CPU : availableBackends.get(0);
            fallbackReason = BACKEND_AUTO.equals(requested)
                ? "selected_backend_unavailable" : "requested_backend_unavailable";
        }
        if (!thermalSafe && !BACKEND_CPU.equals(preferred)) {
            if (!availableBackends.contains(BACKEND_CPU)) throw new IllegalStateException("local_model_thermal_limit");
            preferred = BACKEND_CPU;
            fallbackReason = "thermal_severe";
        }
        return new BackendChoice(preferred, fallbackReason);
    }

    static Benchmark selectFastest(List<Benchmark> input) {
        List<Benchmark> candidates = rankCandidates(input);
        if (candidates.isEmpty()) return null;
        Benchmark fastest = candidates.get(0);
        for (Benchmark candidate : candidates) {
            if (candidate.score >= fastest.score * 0.95 && candidate.residentBytes < fastest.residentBytes) fastest = candidate;
        }
        return fastest;
    }

    static List<Benchmark> selectFinalists(List<Benchmark> input, String requestedBackend) {
        List<Benchmark> ranked = rankCandidates(input);
        List<Benchmark> finalists = new ArrayList<>();
        for (Benchmark candidate : ranked) {
            if (finalists.size() >= 2) break;
            finalists.add(candidate);
        }
        addBestBackend(finalists, ranked, BACKEND_CPU);
        String requested = normalizeBackend(requestedBackend);
        if (!BACKEND_AUTO.equals(requested)) addBestBackend(finalists, ranked, requested);
        return finalists;
    }

    static boolean shouldRefineGpuOffload(Benchmark cpu, Benchmark gpu) {
        if (cpu == null || gpu == null || !cpu.succeeded() || !gpu.succeeded()) return false;
        double bestFirstToken = Math.min(cpu.firstTokenMs, gpu.firstTokenMs);
        double bestPrefill = Math.max(cpu.prefillTokensPerSecond, gpu.prefillTokensPerSecond);
        double bestDecode = Math.max(cpu.decodeTokensPerSecond, gpu.decodeTokensPerSecond);
        double cpuScore = compositeScore(cpu, bestFirstToken, bestPrefill, bestDecode);
        double gpuScore = compositeScore(gpu, bestFirstToken, bestPrefill, bestDecode);
        // A medium offload that is already close to CPU may improve materially at a higher layer count.
        return gpuScore >= cpuScore * 0.90d;
    }

    static long requiredSystemHeadroom(long totalRamBytes) {
        long proportional = totalRamBytes <= 0 ? 0 : Math.round(totalRamBytes * 0.15d);
        return Math.max(GIB, proportional);
    }

    static boolean hasInferenceHeadroom(long totalRamBytes, long availableRamBytes, long requestedBytes) {
        if (requestedBytes < 0 || availableRamBytes < 0) return false;
        return availableRamBytes - requestedBytes >= requiredSystemHeadroom(totalRamBytes);
    }

    static List<Integer> gpuLayerCandidates(int layerCount, String mode) {
        if (layerCount <= 0) return List.of(0);
        int[] percentages = MODE_EXTREME.equals(normalizeMode(mode))
            ? new int[] {100, 75, 50, 25, 0}
            : new int[] {75, 50, 25, 0};
        List<Integer> layers = new ArrayList<>();
        for (int percent : percentages) {
            int count = percent == 100 ? layerCount : (int) Math.floor(layerCount * percent / 100.0d);
            if (!layers.contains(count)) layers.add(count);
        }
        return layers;
    }

    static boolean shouldRecalibrate(double calibratedDecodeTokensPerSecond, List<Double> recentDecodeRates) {
        if (calibratedDecodeTokensPerSecond <= 0 || recentDecodeRates == null || recentDecodeRates.size() < 3) return false;
        List<Double> tail = recentDecodeRates.subList(recentDecodeRates.size() - 3, recentDecodeRates.size());
        return tail.stream().allMatch(value -> value != null && value > 0 && value < calibratedDecodeTokensPerSecond * 0.80);
    }

    static String cacheKey(String... parts) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            for (String part : parts) {
                digest.update((part == null ? "" : part).getBytes(StandardCharsets.UTF_8));
                digest.update((byte) 0);
            }
            StringBuilder result = new StringBuilder(64);
            for (byte value : digest.digest()) result.append(String.format(Locale.ROOT, "%02x", value & 0xff));
            return result.toString();
        } catch (Exception impossible) {
            throw new IllegalStateException("acceleration_cache_key_failed", impossible);
        }
    }

    static String normalizeMode(String value) {
        return MODE_EXTREME.equals(value) ? MODE_EXTREME : MODE_AUTO;
    }

    static String normalizeBackend(String value) {
        if (BACKEND_CPU.equals(value) || BACKEND_GPU.equals(value) || BACKEND_NPU.equals(value)) return value;
        return BACKEND_AUTO;
    }

    private static double finitePositive(double value) {
        return Double.isFinite(value) && value > 0 ? value : 0.0;
    }

    private static double compositeScore(
        Benchmark candidate,
        double bestFirstToken,
        double bestPrefill,
        double bestDecode
    ) {
        return 0.40 * bestFirstToken / candidate.firstTokenMs
            + 0.20 * candidate.prefillTokensPerSecond / bestPrefill
            + 0.40 * candidate.decodeTokensPerSecond / bestDecode;
    }

    private static List<Benchmark> rankCandidates(List<Benchmark> input) {
        List<Benchmark> candidates = new ArrayList<>();
        for (Benchmark benchmark : input) if (benchmark != null && benchmark.succeeded()) candidates.add(benchmark);
        if (candidates.isEmpty()) return candidates;
        double bestFirstToken = candidates.stream().mapToDouble(value -> value.firstTokenMs).min().orElse(1.0);
        double bestPrefill = candidates.stream().mapToDouble(value -> value.prefillTokensPerSecond).max().orElse(1.0);
        double bestDecode = candidates.stream().mapToDouble(value -> value.decodeTokensPerSecond).max().orElse(1.0);
        for (Benchmark candidate : candidates) {
            candidate.score = compositeScore(candidate, bestFirstToken, bestPrefill, bestDecode);
        }
        candidates.sort(Comparator.comparingDouble((Benchmark value) -> value.score).reversed());
        return candidates;
    }

    private static void addBestBackend(List<Benchmark> finalists, List<Benchmark> ranked, String backend) {
        for (Benchmark candidate : ranked) {
            if (!backend.equals(candidate.backend) || finalists.contains(candidate)) continue;
            finalists.add(candidate);
            return;
        }
    }
}
