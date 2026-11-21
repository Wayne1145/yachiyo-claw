package io.github.yachiyoclaw.sandbox;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public final class SandboxJobStorePolicyTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();

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
        assertFalse(SandboxJobStore.shouldInterrupt(queued, 60_000, SandboxJobStore.Owner.LEGACY, false));
    }

    @Test public void preservesRecoveryForJobsStartedByAnOlderApk() {
        SandboxJobStore.Job running = new SandboxJobStore.Job(
            "running", "cipher", "/workspace", 1000, SandboxJobStore.STATE_RUNNING, 1, 500, 42, null
        );
        assertFalse(SandboxJobStore.shouldInterrupt(running, 1_499, SandboxJobStore.Owner.LEGACY, true));
        assertTrue(SandboxJobStore.shouldInterrupt(running, 1_500, SandboxJobStore.Owner.LEGACY, true));
        assertTrue(SandboxJobStore.shouldInterrupt(running, 600, SandboxJobStore.Owner.LEGACY, false));
    }

    @Test public void childExitAndDeadlineDoNotPublishInterruptionWhileTheServiceCommitsItsResult() throws Exception {
        File file = new File(temporary.getRoot(), "job.owner");
        SandboxJobStore.Job running = new SandboxJobStore.Job("job", "cipher", "workspace", 1000, "running", 1, 1, 0, null);
        assertEquals(SandboxJobStore.Owner.LEGACY, SandboxJobStore.JobLease.owner(file));
        try (SandboxJobStore.JobLease lease = SandboxJobStore.JobLease.acquire(file)) {
            assertNotNull(lease);
            assertNull(SandboxJobStore.JobLease.acquire(file));
            for (int poll = 0; poll < 5; poll++) {
                assertFalse(SandboxJobStore.shouldInterrupt(running, 60_000 + poll * 250L, SandboxJobStore.JobLease.owner(file), false));
            }
        }
        assertTrue(SandboxJobStore.shouldInterrupt(running, 100, SandboxJobStore.JobLease.owner(file), true));
    }

    @Test public void processDeathReleasesOwnershipEvenIfAGuestPidIsStillPresent() throws Exception {
        File file = new File(temporary.getRoot(), "job.owner");
        String java = new File(System.getProperty("java.home"), "bin/java").getPath();
        String classes = new File(LeaseProcess.class.getProtectionDomain().getCodeSource().getLocation().toURI()).getPath();
        Process owner = new ProcessBuilder(java, "-cp", classes, LeaseProcess.class.getName(), file.getPath()).start();
        try {
            int marker = CompletableFuture.supplyAsync(() -> {
                try { return owner.getInputStream().read(); } catch (java.io.IOException error) { throw new IllegalStateException(error); }
            }).get(15, TimeUnit.SECONDS);
            assertEquals('L', marker);
            assertEquals(SandboxJobStore.Owner.ACTIVE, SandboxJobStore.JobLease.owner(file));
            assertNull(SandboxJobStore.JobLease.acquire(file));
            assertEquals(SandboxJobStore.Owner.ACTIVE, SandboxJobStore.JobLease.owner(file));
        } finally {
            owner.destroyForcibly();
            assertTrue(owner.waitFor(10, TimeUnit.SECONDS));
        }
        // Windows can signal the process handle before kernel lock cleanup finishes.
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
        while (SandboxJobStore.JobLease.owner(file) == SandboxJobStore.Owner.ACTIVE && System.nanoTime() < deadline) {
            Thread.sleep(20);
        }
        assertEquals(SandboxJobStore.Owner.ABANDONED, SandboxJobStore.JobLease.owner(file));
    }

    public static final class LeaseProcess {
        public static void main(String[] args) throws Exception {
            try (FileChannel channel = FileChannel.open(Path.of(args[0]), StandardOpenOption.CREATE, StandardOpenOption.WRITE);
                 FileLock lock = channel.lock()) {
                System.out.write('L');
                System.out.flush();
                System.in.read();
            }
        }
    }

    @Test public void terminalResultCannotBeRewrittenByLateStopOrCompletion() {
        for (String terminal : List.of("succeeded", "failed", "cancelled", "interrupted")) assertFalse(SandboxJobStore.canUpdate(terminal));
        assertTrue(SandboxJobStore.canUpdate("queued"));
        assertTrue(SandboxJobStore.canUpdate("running"));
    }
}
