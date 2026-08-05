package io.github.yachiyoclaw.model;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import java.util.List;
import org.junit.Test;

public final class AccelerationPolicyTest {
    @Test public void selectsBestCompositeChatPerformance() {
        AccelerationPolicy.Benchmark cpu = benchmark("cpu", 100, 220, 80, 20, 900);
        AccelerationPolicy.Benchmark gpu = benchmark("gpu", 200, 100, 180, 55, 1_200);
        AccelerationPolicy.Benchmark npu = benchmark("npu", 400, 90, 160, 45, 800);

        assertEquals("gpu", AccelerationPolicy.selectFastest(List.of(cpu, gpu, npu)).backend);
    }

    @Test public void prefersLowerMemoryWithinFivePercent() {
        AccelerationPolicy.Benchmark gpu = benchmark("gpu", 100, 100, 100, 100, 1_500);
        AccelerationPolicy.Benchmark npu = benchmark("npu", 100, 104, 98, 98, 700);

        assertEquals("npu", AccelerationPolicy.selectFastest(List.of(gpu, npu)).backend);
    }

    @Test public void ignoresFailedCandidate() {
        AccelerationPolicy.Benchmark failed = new AccelerationPolicy.Benchmark("gpu", 1, 1, 1, 1, 1, "gpu_failed");
        assertEquals("cpu", AccelerationPolicy.selectFastest(List.of(failed, benchmark("cpu", 1, 2, 3, 4, 5))).backend);
    }

    @Test public void refinesGpuOnlyWhenMediumOffloadIsCompetitive() {
        AccelerationPolicy.Benchmark cpu = benchmark("cpu", 100, 100, 100, 30, 900);
        AccelerationPolicy.Benchmark competitiveGpu = benchmark("gpu", 140, 110, 130, 29, 1_100);
        AccelerationPolicy.Benchmark slowGpu = benchmark("gpu", 180, 180, 70, 15, 1_100);

        assertTrue(AccelerationPolicy.shouldRefineGpuOffload(cpu, competitiveGpu));
        assertFalse(AccelerationPolicy.shouldRefineGpuOffload(cpu, slowGpu));
    }

    @Test public void finalistsKeepFastestPairCpuSafetyAndManualBackend() {
        AccelerationPolicy.Benchmark gpuFast = benchmark("gpu", 100, 80, 150, 60, 1_200);
        AccelerationPolicy.Benchmark gpuSecond = benchmark("gpu", 100, 90, 140, 55, 1_100);
        AccelerationPolicy.Benchmark cpu = benchmark("cpu", 100, 180, 80, 24, 800);
        AccelerationPolicy.Benchmark npu = benchmark("npu", 150, 200, 75, 22, 700);

        List<AccelerationPolicy.Benchmark> finalists = AccelerationPolicy.selectFinalists(
            List.of(cpu, gpuSecond, npu, gpuFast), "npu");

        assertEquals(List.of(gpuFast, gpuSecond, cpu, npu), finalists);
    }

    @Test public void keepsAConservativeButBoundedSystemReserve() {
        assertEquals(512L * 1024L * 1024L, AccelerationPolicy.requiredSystemHeadroom(4L * 1024L * 1024L * 1024L));
        assertEquals(1024L * 1024L * 1024L, AccelerationPolicy.requiredSystemHeadroom(20L * 1024L * 1024L * 1024L));
        assertFalse(AccelerationPolicy.hasInferenceHeadroom(8L << 30, 1535L << 20, 1L << 30));
        assertTrue(AccelerationPolicy.hasInferenceHeadroom(8L << 30, 2L << 30, 1L << 30));
    }

    @Test public void createsDeterministicLayerFallbacks() {
        assertEquals(List.of(40, 30, 20, 10, 0), AccelerationPolicy.gpuLayerCandidates(40, "extreme"));
        assertEquals(List.of(30, 20, 10, 0), AccelerationPolicy.gpuLayerCandidates(40, "auto"));
    }

    @Test public void recalibratesAfterThreeMaterialRegressions() {
        assertFalse(AccelerationPolicy.shouldRecalibrate(50, List.of(38.0, 42.0, 39.0)));
        assertTrue(AccelerationPolicy.shouldRecalibrate(50, List.of(60.0, 39.0, 38.0, 37.0)));
    }

    @Test public void cacheKeyIncludesEveryIdentityPart() {
        String first = AccelerationPolicy.cacheKey("model", "soc", "driver", "auto");
        assertEquals(first, AccelerationPolicy.cacheKey("model", "soc", "driver", "auto"));
        assertNotEquals(first, AccelerationPolicy.cacheKey("model", "soc", "driver", "extreme"));
    }

    @Test public void unavailableManualBackendFallsBackWithoutFalseActivation() {
        AccelerationPolicy.BackendChoice choice = AccelerationPolicy.selectRuntimeBackend(
            "npu", "gpu", List.of("cpu", "gpu"), true);
        assertEquals("gpu", choice.backend);
        assertEquals("requested_backend_unavailable", choice.fallbackReason);
    }

    @Test public void severeThermalStatusUsesMeasuredCpuFallback() {
        AccelerationPolicy.BackendChoice choice = AccelerationPolicy.selectRuntimeBackend(
            "auto", "gpu", List.of("cpu", "gpu"), false);
        assertEquals("cpu", choice.backend);
        assertEquals("thermal_severe", choice.fallbackReason);
    }

    private static AccelerationPolicy.Benchmark benchmark(
        String backend, double init, double first, double prefill, double decode, long resident
    ) {
        return new AccelerationPolicy.Benchmark(backend, init, first, prefill, decode, resident, null);
    }
}
