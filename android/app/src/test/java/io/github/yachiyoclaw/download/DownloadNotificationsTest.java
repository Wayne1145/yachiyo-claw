package io.github.yachiyoclaw.download;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;

import java.util.HashMap;
import java.util.Map;
import org.junit.Test;

public final class DownloadNotificationsTest {
    @Test
    public void resolvesKnownJavaHashCollisionWithoutChangingExistingIds() {
        // "Aa" and "BB" intentionally have the same String.hashCode().
        Map<String, Integer> assigned = new HashMap<>();
        int aa = DownloadNotifications.allocateId("Aa", assigned);
        assigned.put("Aa", aa);
        int bb = DownloadNotifications.allocateId("BB", assigned);
        assigned.put("BB", bb);

        assertNotEquals(aa, bb);
        assertEquals(aa, DownloadNotifications.allocateId("Aa", assigned));
        assertEquals(bb, DownloadNotifications.allocateId("BB", assigned));
    }

    @Test
    public void progressTextIncludesSpeedAndTransferredBytes() {
        assertEquals(
            "50% · 8.00 MB/s · 1.00 GB / 2.00 GB",
            DownloadNotifications.progressText(1024L * 1024L * 1024L, 2L * 1024L * 1024L * 1024L, 8L * 1024L * 1024L)
        );
    }

    @Test
    public void progressTextOmitsZeroSpeed() {
        assertEquals("25% · 256 MB / 1.00 GB", DownloadNotifications.progressText(256L * 1024L * 1024L, 1024L * 1024L * 1024L, 0));
    }
}
