package io.github.yachiyoclaw.download;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import org.junit.Test;

public final class GenericDownloadWorkerTest {
    @Test public void rejectsCleartextAndPrivateDestinations() {
        assertThrows(IllegalArgumentException.class, () -> GenericDownloadWorker.requirePublicHttps("http://example.com/file"));
        assertThrows(IllegalArgumentException.class, () -> GenericDownloadWorker.requirePublicHttps("https://127.0.0.1/file"));
        assertThrows(IllegalArgumentException.class, () -> GenericDownloadWorker.requirePublicHttps("https://[::1]/file"));
    }

    @Test public void rejectsCredentialsFragmentsAndCustomPorts() {
        assertThrows(IllegalArgumentException.class, () -> GenericDownloadWorker.requirePublicHttps("https://user@example.com/file"));
        assertThrows(IllegalArgumentException.class, () -> GenericDownloadWorker.requirePublicHttps("https://example.com:8443/file"));
        assertThrows(IllegalArgumentException.class, () -> GenericDownloadWorker.requirePublicHttps("https://example.com/file#fragment"));
    }

    @Test public void parsesStrictContentRangeTotals() {
        assertEquals(4096L, GenericDownloadWorker.parseContentRangeTotal("bytes 0-0/4096"));
        assertThrows(IllegalStateException.class, () -> GenericDownloadWorker.parseContentRangeTotal("bytes */4096"));
        assertThrows(IllegalStateException.class, () -> GenericDownloadWorker.parseContentRangeTotal("bytes 0-0/*"));
        assertThrows(IllegalStateException.class, () -> GenericDownloadWorker.parseContentRangeTotal("garbage"));
    }
}
