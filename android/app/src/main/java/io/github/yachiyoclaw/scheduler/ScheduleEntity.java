package io.github.yachiyoclaw.scheduler;

import androidx.annotation.NonNull;
import androidx.room.Entity;
import androidx.room.PrimaryKey;

/**
 * Durable schedule metadata. The prompt and provider configuration are kept in payloadEnvelope,
 * which is an Android Keystore-backed envelope rather than plaintext.
 */
@Entity(tableName = "scheduler_schedules")
public final class ScheduleEntity {
    @PrimaryKey
    @NonNull
    public String id = "";
    @NonNull
    public String title = "";
    @NonNull
    public String payloadEnvelope = "";
    @NonNull
    public String repeat = "once";
    @NonNull
    public String status = SchedulerState.SCHEDULED;
    @NonNull
    public String timezone = "UTC";
    @NonNull
    public String currentExecutionId = "";
    public long runAt;
    public long nextRunAt;
    public long createdAt;
    public long updatedAt;
    public boolean enabled;
    public boolean exact;
    public boolean requiresNetwork;
}


