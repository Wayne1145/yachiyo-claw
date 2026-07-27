package io.github.yachiyoclaw.sandbox;

import static org.junit.Assert.assertEquals;

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
}
