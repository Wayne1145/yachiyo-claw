package io.github.yachiyoclaw.scheduler;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class SchedulerRecoveryPolicyTest {
    @Test
    public void supportsExpectedSystemRecoveryEvents() {
        assertTrue(SchedulerRecoveryPolicy.supports(SchedulerRecoveryPolicy.BOOT_COMPLETED));
        assertTrue(SchedulerRecoveryPolicy.supports(SchedulerRecoveryPolicy.LOCKED_BOOT_COMPLETED));
        assertTrue(SchedulerRecoveryPolicy.supports(SchedulerRecoveryPolicy.USER_UNLOCKED));
        assertTrue(SchedulerRecoveryPolicy.supports(SchedulerRecoveryPolicy.PACKAGE_REPLACED));
        assertTrue(SchedulerRecoveryPolicy.supports(SchedulerRecoveryPolicy.TIME_SET));
        assertTrue(SchedulerRecoveryPolicy.supports(SchedulerRecoveryPolicy.TIMEZONE_CHANGED));
        assertFalse(SchedulerRecoveryPolicy.supports("android.intent.action.SCREEN_ON"));
    }

    @Test
    public void defersCredentialProtectedStateUntilUserUnlock() {
        assertFalse(SchedulerRecoveryPolicy.shouldReconcile(SchedulerRecoveryPolicy.LOCKED_BOOT_COMPLETED, false));
        assertTrue(SchedulerRecoveryPolicy.shouldReconcile(SchedulerRecoveryPolicy.USER_UNLOCKED, true));
    }

    @Test
    public void replacesTimeSensitiveOrUpdatedWork() {
        assertTrue(SchedulerRecoveryPolicy.replacesExistingWork(SchedulerRecoveryPolicy.TIME_SET));
        assertTrue(SchedulerRecoveryPolicy.replacesExistingWork(SchedulerRecoveryPolicy.TIMEZONE_CHANGED));
        assertTrue(SchedulerRecoveryPolicy.replacesExistingWork(SchedulerRecoveryPolicy.PACKAGE_REPLACED));
        assertFalse(SchedulerRecoveryPolicy.replacesExistingWork(SchedulerRecoveryPolicy.BOOT_COMPLETED));
    }
}
