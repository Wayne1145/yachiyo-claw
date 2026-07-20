package io.github.yachiyoclaw.scheduler;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class SchedulerPolicyTest {
    @Test
    public void advancesPastMissedDailyRuns() {
        long day = 24 * 60 * 60 * 1000L;
        assertEquals(1_000L + day * 4, SchedulerPolicy.nextRunAt("daily", 1_000L, 1_000L + day * 3));
    }

    @Test
    public void onlyClaimsScheduledOrExpiredRetryableExecutions() {
        assertTrue(SchedulerPolicy.canClaim(SchedulerState.SCHEDULED, 50_000L, 1_000L));
        assertTrue(SchedulerPolicy.canClaim(SchedulerState.RETRYABLE_FAILED, 999L, 1_000L));
        assertFalse(SchedulerPolicy.canClaim(SchedulerState.RETRYABLE_FAILED, 1_001L, 1_000L));
        assertFalse(SchedulerPolicy.canClaim(SchedulerState.CLAIMED, 999L, 1_000L));
    }

    @Test
    public void treatsSucceededPermanentFailureAndCancellationAsTerminal() {
        assertTrue(SchedulerPolicy.isTerminal(SchedulerState.SUCCEEDED));
        assertTrue(SchedulerPolicy.isTerminal(SchedulerState.PERMANENT_FAILED));
        assertTrue(SchedulerPolicy.isTerminal(SchedulerState.CANCELLED));
        assertFalse(SchedulerPolicy.isTerminal(SchedulerState.RETRYABLE_FAILED));
    }
}


