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

    @Test
    public void providerPrefixAndRepositoryResolveToTheCompletedModelIdentity() {
        assertTrue(ModelRegistryStore.matchesModelIdentity(
            "yachiyo-local:google/gemma-4-e4b",
            "google/gemma-4-e4b",
            "google/gemma-4-e4b",
            "job-1"
        ));
        assertTrue(ModelRegistryStore.matchesModelIdentity(
            "modelscope:google/gemma-4-e4b",
            "catalog-entry",
            "google/gemma-4-e4b",
            "job-1"
        ));
        assertFalse(ModelRegistryStore.matchesModelIdentity(
            "another/model",
            "google/gemma-4-e4b",
            "google/gemma-4-e4b",
            "job-1"
        ));
    }

}
