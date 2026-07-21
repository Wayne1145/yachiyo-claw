package io.github.yachiyoclaw.model;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ModelRegistryStoreTest {
    @Test
    public void workerWritesOnlyWhileJobIsActive() {
        assertTrue(ModelRegistryStore.isWorkerActive("queued"));
        assertTrue(ModelRegistryStore.isWorkerActive("downloading"));
        assertFalse(ModelRegistryStore.isWorkerActive("paused"));
        assertFalse(ModelRegistryStore.isWorkerActive("cancelled"));
        assertFalse(ModelRegistryStore.isWorkerActive("completed"));
        assertFalse(ModelRegistryStore.isWorkerActive("failed"));
    }
}
