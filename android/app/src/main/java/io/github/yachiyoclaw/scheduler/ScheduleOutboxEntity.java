package io.github.yachiyoclaw.scheduler;

import androidx.annotation.NonNull;
import androidx.room.Entity;
import androidx.room.Index;
import androidx.room.PrimaryKey;

/**
 * At-least-once handoff from a Worker to the foreground WebView. Delivery leases make a crashed
 * renderer recoverable without putting task prompts in notification text or WorkManager input.
 */
@Entity(
    tableName = "scheduler_outbox",
    indices = {
        @Index(value = {"delivered", "deliveryLeaseExpiresAt"}),
        @Index(value = {"executionId"}, unique = true)
    }
)
public final class ScheduleOutboxEntity {
    @PrimaryKey
    @NonNull
    public String id = "";
    @NonNull
    public String scheduleId = "";
    @NonNull
    public String executionId = "";
    @NonNull
    public String eventType = SchedulerState.OUTBOX_WAKE;
    @NonNull
    public String payloadJson = "{}";
    @NonNull
    public String deliveryToken = "";
    public long createdAt;
    public long deliveryLeaseExpiresAt;
    public long deliveredAt;
    public boolean delivered;
}


