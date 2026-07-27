package io.github.yachiyoclaw.download;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class DownloadTaskStoreRaceTest {
    @Test
    public void stoppedReplacedWorkerCannotOverwriteSuccessorState() {
        assertTrue(DownloadTaskStore.shouldIgnoreStoppedWorkerResult("queued", true));
        assertTrue(DownloadTaskStore.shouldIgnoreStoppedWorkerResult("downloading", true));
        assertTrue(DownloadTaskStore.shouldIgnoreStoppedWorkerResult("completed", true));
    }

    @Test
    public void explicitPauseAndCancelRemainAuthoritative() {
        assertFalse(DownloadTaskStore.shouldIgnoreStoppedWorkerResult("paused", true));
        assertFalse(DownloadTaskStore.shouldIgnoreStoppedWorkerResult("cancelled", true));
        assertFalse(DownloadTaskStore.shouldIgnoreStoppedWorkerResult("queued", false));
    }
}
