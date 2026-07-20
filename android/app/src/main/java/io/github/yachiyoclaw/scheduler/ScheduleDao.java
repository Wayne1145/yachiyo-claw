package io.github.yachiyoclaw.scheduler;

import androidx.room.Dao;
import androidx.room.Insert;
import androidx.room.OnConflictStrategy;
import androidx.room.Query;
import java.util.List;

@Dao
public interface ScheduleDao {
    @Query("SELECT * FROM scheduler_schedules ORDER BY nextRunAt ASC, createdAt ASC")
    List<ScheduleEntity> listSchedules();

    @Query("SELECT * FROM scheduler_schedules WHERE id = :id LIMIT 1")
    ScheduleEntity findSchedule(String id);

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    void upsertSchedule(ScheduleEntity schedule);

    @Query("DELETE FROM scheduler_schedules WHERE id = :id")
    int deleteSchedule(String id);

    @Query("SELECT * FROM scheduler_executions WHERE id = :id LIMIT 1")
    ScheduleExecutionEntity findExecution(String id);

    @Query("SELECT * FROM scheduler_executions WHERE scheduleId = :scheduleId ORDER BY scheduledAt DESC")
    List<ScheduleExecutionEntity> listExecutions(String scheduleId);

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    void upsertExecution(ScheduleExecutionEntity execution);

    @Query("DELETE FROM scheduler_executions WHERE scheduleId = :scheduleId")
    void deleteExecutions(String scheduleId);

    @Query(
        "UPDATE scheduler_executions SET status = 'claimed', claimedAt = :now, " +
        "leaseExpiresAt = :leaseExpiresAt, attempt = attempt + 1 " +
        "WHERE id = :executionId AND scheduleId = :scheduleId " +
        "AND (status = 'scheduled' OR (status = 'retryable-failed' AND leaseExpiresAt <= :now))"
    )
    int claimExecution(String scheduleId, String executionId, long now, long leaseExpiresAt);

    @Query(
        "UPDATE scheduler_executions SET status = :status, leaseExpiresAt = 0, " +
        "startedAt = CASE WHEN :status = 'running' AND startedAt = 0 THEN :now ELSE startedAt END " +
        "WHERE id = :executionId AND scheduleId = :scheduleId AND status = 'claimed'"
    )
    int markExecutionRunning(String scheduleId, String executionId, String status, long now);

    @Query(
        "UPDATE scheduler_executions SET status = 'running', leaseExpiresAt = 0, " +
        "startedAt = CASE WHEN startedAt = 0 THEN :now ELSE startedAt END, checkpointJson = :checkpointJson " +
        "WHERE id = :executionId AND scheduleId = :scheduleId AND status = 'awaiting-foreground'"
    )
    int beginForegroundExecution(String scheduleId, String executionId, String checkpointJson, long now);

    @Query(
        "UPDATE scheduler_executions SET status = :status, leaseExpiresAt = 0, " +
        "lastError = :lastError, finishedAt = :finishedAt " +
        "WHERE id = :executionId AND scheduleId = :scheduleId"
    )
    int finishExecution(String scheduleId, String executionId, String status, String lastError, long finishedAt);

    @Query(
        "UPDATE scheduler_executions SET status = :status, leaseExpiresAt = 0, " +
        "lastError = :lastError WHERE id = :executionId AND scheduleId = :scheduleId"
    )
    int setExecutionState(String scheduleId, String executionId, String status, String lastError);

    @Query(
        "UPDATE scheduler_executions SET status = :status, leaseExpiresAt = 0, " +
        "lastError = :lastError WHERE id = :executionId AND scheduleId = :scheduleId " +
        "AND status IN ('running', 'awaiting-foreground', 'paused', 'awaiting-approval', 'retryable-failed')"
    )
    int acknowledgeExecution(String scheduleId, String executionId, String status, String lastError);

    @Query(
        "UPDATE scheduler_executions SET status = 'retryable-failed', leaseExpiresAt = 0, " +
        "lastError = :lastError WHERE status IN ('claimed', 'running') AND leaseExpiresAt > 0 " +
        "AND leaseExpiresAt <= :now"
    )
    int recoverExpiredLeases(long now, String lastError);

    @Query("SELECT * FROM scheduler_outbox WHERE id = :id LIMIT 1")
    ScheduleOutboxEntity findOutbox(String id);

    @Query("SELECT * FROM scheduler_outbox WHERE executionId = :executionId LIMIT 1")
    ScheduleOutboxEntity findOutboxForExecution(String executionId);

    @Query(
        "SELECT * FROM scheduler_outbox WHERE delivered = 0 AND " +
        "(deliveryLeaseExpiresAt = 0 OR deliveryLeaseExpiresAt <= :now) " +
        "ORDER BY createdAt ASC LIMIT :limit"
    )
    List<ScheduleOutboxEntity> findClaimableOutbox(long now, int limit);

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    long insertOutbox(ScheduleOutboxEntity outbox);

    @Query(
        "UPDATE scheduler_outbox SET deliveryToken = :token, deliveryLeaseExpiresAt = :leaseExpiresAt " +
        "WHERE id = :id AND delivered = 0 AND (deliveryLeaseExpiresAt = 0 OR deliveryLeaseExpiresAt <= :now)"
    )
    int claimOutbox(String id, String token, long now, long leaseExpiresAt);

    @Query(
        "UPDATE scheduler_outbox SET delivered = 1, deliveredAt = :deliveredAt, " +
        "deliveryLeaseExpiresAt = 0 WHERE id = :id AND delivered = 0 AND deliveryToken = :token"
    )
    int markOutboxDelivered(String id, String token, long deliveredAt);

    @Query("DELETE FROM scheduler_outbox WHERE scheduleId = :scheduleId")
    void deleteOutbox(String scheduleId);
}


