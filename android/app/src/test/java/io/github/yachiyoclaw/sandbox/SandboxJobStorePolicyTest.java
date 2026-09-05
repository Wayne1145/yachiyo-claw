package io.github.yachiyoclaw.sandbox;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.List;
import org.junit.Test;

public final class SandboxJobStorePolicyTest {
    @Test
    public void filtersOnlyJobsBoundToThePluginWorkspace() {
        SandboxJobStore.Job first = new SandboxJobStore.Job(
            "first", "cipher", "/data/workspaces/plugin-a", 10_000,
            SandboxJobStore.STATE_RUNNING, 1, 2, 3, null
        );
        SandboxJobStore.Job second = new SandboxJobStore.Job(
            "second", "cipher", "/data/workspaces/plugin-b", 10_000,
            SandboxJobStore.STATE_SUCCEEDED, 1, 2, 0, 0
        );
        SandboxJobStore.Job third = new SandboxJobStore.Job(
            "third", "cipher", "/data/workspaces/plugin-a", 10_000,
            SandboxJobStore.STATE_QUEUED, 1, 2, 0, null
        );

        assertEquals(
            List.of("first", "third"),
            SandboxJobStore.jobIdsForWorkspace(List.of(first, second, third), "/data/workspaces/plugin-a")
        );
    }

    @Test public void legacyConstructorDefaultsToAlpineWhileNewJobsKeepRuntimeIdentity() {
        SandboxJobStore.Job legacy = new SandboxJobStore.Job(
            "legacy", "cipher", "/workspace", 1000, "queued", 1, 1, 0, null
        );
        assertEquals("alpine", legacy.runtimeId);
        SandboxJobStore.Job ubuntu = new SandboxJobStore.Job(
            "ubuntu", "cipher", "/workspace", 1000, "queued", 1, 1, 0, null, UbuntuDistribution.RUNTIME_ID
        );
        assertEquals(UbuntuDistribution.RUNTIME_ID, ubuntu.runtimeId);
    }

    @Test public void reconcileLeavesQueuedJobsRecoverable() {
        SandboxJobStore.Job queued = new SandboxJobStore.Job(
            "queued", "cipher", "/workspace", 1000, SandboxJobStore.STATE_QUEUED, 1, 1, 0, null
        );
        assertFalse(SandboxJobStore.shouldInterrupt(queued, 60_000, false));
    }

    @Test public void reconcileInterruptsOnlyDeadOrExpiredRunningJobs() {
        SandboxJobStore.Job running = new SandboxJobStore.Job(
            "running", "cipher", "/workspace", 1000, SandboxJobStore.STATE_RUNNING, 1, 500, 42, null
        );
        assertFalse(SandboxJobStore.shouldInterrupt(running, 1_499, true));
        assertTrue(SandboxJobStore.shouldInterrupt(running, 1_500, true));
        assertTrue(SandboxJobStore.shouldInterrupt(running, 600, false));
    }
}
