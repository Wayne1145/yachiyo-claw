package io.github.yachiyoclaw.download;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import io.github.yachiyoclaw.download.DownloadTaskStore.TaskMeta;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.junit.Test;

/** Covers the pure bounded-history and ordering decisions of the unified download index. */
public class DownloadTaskStoreTest {

    private static TaskMeta meta(String id, String status, long updatedAt) {
        return new TaskMeta(id, status, updatedAt);
    }

    private static TaskMeta retained(String id, String status, long updatedAt) {
        return new TaskMeta(id, status, updatedAt, true);
    }

    @Test
    public void keepsEverythingWhenUnderBounds() {
        List<TaskMeta> tasks = new ArrayList<>();
        tasks.add(meta("a", "downloading", 10));
        tasks.add(meta("b", "completed", 5));
        assertTrue(DownloadTaskStore.idsToDrop(tasks, 40, 120).isEmpty());
    }

    @Test
    public void evictsOldestTerminalBeyondCapButNeverActive() {
        List<TaskMeta> tasks = new ArrayList<>();
        for (int i = 0; i < 50; i++) tasks.add(meta("done-" + i, "completed", i));
        tasks.add(meta("live", "downloading", 0)); // active, oldest timestamp
        Set<String> drop = DownloadTaskStore.idsToDrop(tasks, 40, 120);
        assertEquals(10, drop.size()); // 50 terminal - 40 cap
        assertFalse("active task must never be evicted", drop.contains("live"));
        assertTrue("oldest terminal dropped first", drop.contains("done-0"));
        assertTrue(drop.contains("done-9"));
        assertFalse("newest terminal kept", drop.contains("done-49"));
    }

    @Test
    public void enforcesGlobalCapPreferringTerminalThenOldest() {
        List<TaskMeta> tasks = new ArrayList<>();
        // 5 active + 5 terminal, cap total to 6, terminal cap generous so global cap is the driver.
        for (int i = 0; i < 5; i++) tasks.add(meta("live-" + i, "downloading", 100 + i));
        for (int i = 0; i < 5; i++) tasks.add(meta("done-" + i, "failed", i));
        Set<String> drop = DownloadTaskStore.idsToDrop(tasks, 40, 6);
        assertEquals(4, drop.size()); // 10 - 6
        // All 4 removed should be terminal (droppable before active), oldest first.
        assertTrue(drop.contains("done-0"));
        assertTrue(drop.contains("done-3"));
        assertFalse(drop.contains("done-4")); // newest terminal survives
        for (int i = 0; i < 5; i++) assertFalse(drop.contains("live-" + i));
    }

    @Test
    public void displayOrderPutsActiveFirstThenNewest() {
        List<TaskMeta> tasks = new ArrayList<>();
        tasks.add(meta("old-done", "completed", 1));
        tasks.add(meta("new-done", "completed", 9));
        tasks.add(meta("old-live", "downloading", 2));
        tasks.add(meta("new-live", "paused", 8));
        List<TaskMeta> ordered = DownloadTaskStore.displayOrder(tasks);
        assertEquals("new-live", ordered.get(0).id); // active, newest
        assertEquals("old-live", ordered.get(1).id); // active, older
        assertEquals("new-done", ordered.get(2).id); // terminal, newest
        assertEquals("old-done", ordered.get(3).id);
    }

    @Test
    public void pausedCountsAsActiveNotTerminal() {
        assertFalse(DownloadTaskStore.isTerminal("paused"));
        assertFalse(DownloadTaskStore.isTerminal("downloading"));
        assertTrue(DownloadTaskStore.isTerminal("completed"));
        assertTrue(DownloadTaskStore.isTerminal("failed"));
        assertTrue(DownloadTaskStore.isTerminal("cancelled"));
    }

    @Test
    public void neverEvictsCompletedArtifactAwaitingConsumption() {
        List<TaskMeta> tasks = new ArrayList<>();
        tasks.add(retained("awaiting-consumer", "completed", 0));
        for (int i = 0; i < 50; i++) tasks.add(meta("history-" + i, "completed", i + 1));
        Set<String> drop = DownloadTaskStore.idsToDrop(tasks, 40, 120);
        assertEquals(10, drop.size());
        assertFalse(drop.contains("awaiting-consumer"));
    }

    @Test
    public void hardCapMayYieldToRecoverablePayloadsAndActiveWork() {
        List<TaskMeta> tasks = new ArrayList<>();
        for (int i = 0; i < 8; i++) tasks.add(retained("payload-" + i, "completed", i));
        tasks.add(meta("live", "queued", 20));
        Set<String> drop = DownloadTaskStore.idsToDrop(tasks, 40, 2);
        assertTrue(drop.isEmpty());
    }
}
