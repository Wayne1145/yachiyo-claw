package io.github.yachiyoclaw.scheduler;

/** Immutable handoff used by the runtime when scheduling a persisted execution. */
public final class ScheduleSnapshot {
    public final ScheduleEntity schedule;
    public final ScheduleExecutionEntity execution;

    public ScheduleSnapshot(ScheduleEntity schedule, ScheduleExecutionEntity execution) {
        this.schedule = schedule;
        this.execution = execution;
    }
}


