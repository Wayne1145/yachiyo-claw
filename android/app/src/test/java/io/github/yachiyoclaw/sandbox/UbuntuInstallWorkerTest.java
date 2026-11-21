package io.github.yachiyoclaw.sandbox;

import static org.junit.Assert.*;
import org.junit.Test;

public class UbuntuInstallWorkerTest {
    private static SandboxJobStore.Job job(String state, Integer exitCode) {
        return new SandboxJobStore.Job("job_test", "", "", 3_600_000, state, 1, 2, 0, exitCode, UbuntuDistribution.RUNTIME_ID);
    }

    @Test public void reportsActualAptFailureAndAllowsNewAttempt() {
        SandboxJobStore.Job failed = job("failed", 100);
        UbuntuInstallWorker.Status status = UbuntuInstallWorker.describe(false, true, "completed", null, failed);
        assertEquals("failed", status.state());
        assertEquals("ubuntu_configuration_exit_100", status.error());
        assertEquals(failed.id, status.jobId());
        assertFalse(UbuntuInstallWorker.reuseRequest(failed.id, failed));
    }

    @Test public void repeatedClicksReuseOnlyPendingOrActiveInstallation() {
        assertTrue(UbuntuInstallWorker.reuseRequest("job_existing", null));
        for (String state : new String[] {"queued", "running"}) {
            SandboxJobStore.Job job = job(state, null);
            assertTrue(UbuntuInstallWorker.reuseRequest(job.id, job));
            assertEquals("configuring", UbuntuInstallWorker.describe(false, true, "completed", null, job).state());
        }
        assertFalse(UbuntuInstallWorker.reuseRequest("removed", null));
        assertFalse(UbuntuInstallWorker.reuseRequest(null, null));
    }

    @Test public void interruptedCancelledAndMissingMarkerRemainActionable() {
        assertEquals("configuration_required", UbuntuInstallWorker.describe(false, true, "completed", null, null).state());
        for (String state : new String[] {"cancelled", "interrupted", "succeeded"}) {
            SandboxJobStore.Job job = job(state, null);
            UbuntuInstallWorker.Status status = UbuntuInstallWorker.describe(false, true, "completed", null, job);
            assertEquals("failed", status.state());
            assertNotNull(status.error());
            assertFalse(UbuntuInstallWorker.reuseRequest(job.id, job));
        }
    }

    @Test public void verifiedMarkerWinsAndPausedDownloadRemainsPaused() {
        assertEquals("ready", UbuntuInstallWorker.describe(true, true, "completed", "stale", job("failed", 100)).state());
        assertEquals("paused", UbuntuInstallWorker.describe(false, false, "paused", null, null).state());
        assertEquals("failed", UbuntuInstallWorker.describe(false, false, "completed", "ubuntu_archive_digest_mismatch", null).state());
    }

    @Test public void offerResumeWhenAndroidDefersBackgroundService() {
        UbuntuInstallWorker.Status status = UbuntuInstallWorker.describe(false, true, "completed", "ubuntu_configuration_foreground_required", job("queued", null));
        assertEquals("configuration_required", status.state());
        assertNull(status.error());
    }
}
