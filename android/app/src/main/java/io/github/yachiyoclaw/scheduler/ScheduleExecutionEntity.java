package io.github.yachiyoclaw.scheduler;

import androidx.annotation.NonNull;
import androidx.room.Entity;
import androidx.room.Index;
import androidx.room.PrimaryKey;

@Entity(
    tableName = "scheduler_executions",
    indices = {
        @Index(value = {"scheduleId", "status"}),
        @Index(value = {"scheduleId", "scheduledAt"})
    }
)
public final class ScheduleExecutionEntity {
    @PrimaryKey
    @NonNull
    public String id = "";
    @NonNull
    public String scheduleId = "";
    @NonNull
    public String status = SchedulerState.SCHEDULED;
    @NonNull
    public String lastError = "";
    @NonNull
    public String checkpointJson = "{}";
    @NonNull
    public String resultJson = "{}";
    public long scheduledAt;
    public long claimedAt;
    public long leaseExpiresAt;
    public long startedAt;
    public long finishedAt;
    public int attempt;
}


