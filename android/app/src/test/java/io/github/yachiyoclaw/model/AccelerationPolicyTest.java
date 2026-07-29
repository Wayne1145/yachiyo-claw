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

    @Test public void reservesAtLeastOneGibAndFifteenPercent() {
        assertEquals(1024L * 1024L * 1024L, AccelerationPolicy.requiredSystemHeadroom(4L * 1024L * 1024L * 1024L));
        assertEquals(3L * 1024L * 1024L * 1024L, AccelerationPolicy.requiredSystemHeadroom(20L * 1024L * 1024L * 1024L));
        assertFalse(AccelerationPolicy.hasInferenceHeadroom(8L << 30, 2L << 30, 1L << 30));
        assertTrue(AccelerationPolicy.hasInferenceHeadroom(8L << 30, 3L << 30, 1L << 30));
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
