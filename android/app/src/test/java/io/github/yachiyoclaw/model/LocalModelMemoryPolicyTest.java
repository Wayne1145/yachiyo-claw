package io.github.yachiyoclaw.model;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class LocalModelMemoryPolicyTest {
    @Test
    public void fallsBackToMmapWhenWeightsCannotBeFullyPreloaded() {
        LocalModelMemoryPolicy.Decision decision = LocalModelMemoryPolicy.decide(6L << 30, 3L << 30, 4L << 30, true);
        assertTrue(decision.runnable());
        assertFalse(decision.eager());
    }

    @Test
    public void permitsFullPreloadWhenModelRuntimeAndSystemReserveFit() {
        LocalModelMemoryPolicy.Decision decision = LocalModelMemoryPolicy.decide(16L << 30, 8L << 30, 4L << 30, true);
        assertTrue(decision.runnable());
        assertTrue(decision.eager());
    }

    @Test
    public void rejectsOnlyWhenRuntimeBuffersDoNotFit() {
        LocalModelMemoryPolicy.Decision decision = LocalModelMemoryPolicy.decide(4L << 30, 700L << 20, 4L << 30, false);
        assertFalse(decision.runnable());
        assertFalse(decision.eager());
    }
}
