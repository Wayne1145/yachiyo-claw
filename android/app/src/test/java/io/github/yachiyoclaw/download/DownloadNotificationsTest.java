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
}
