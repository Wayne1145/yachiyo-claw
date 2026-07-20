package io.github.yachiyoclaw.scheduler;

/** Pure scheduling policy kept Android-free so lease and recurrence rules have fast JVM tests. */
public final class SchedulerPolicy {
    private SchedulerPolicy() {}

    public static long nextRunAt(String repeat, long previousRunAt, long now) {
        if ("once".equals(repeat)) return previousRunAt;
        long interval;
        if ("daily".equals(repeat)) interval = 24 * 60 * 60 * 1000L;
        else if ("weekly".equals(repeat)) interval = 7 * 24 * 60 * 60 * 1000L;
        else throw new IllegalArgumentException("repeat_invalid");
        long next = previousRunAt + interval;
        while (next <= now) next += interval;
        return next;
    }

    public static boolean canClaim(String status, long leaseExpiresAt, long now) {
        if (SchedulerState.SCHEDULED.equals(status)) return true;
        return SchedulerState.RETRYABLE_FAILED.equals(status) && leaseExpiresAt <= now;
    }

    public static boolean isTerminal(String status) {
        return SchedulerState.SUCCEEDED.equals(status) ||
            SchedulerState.PERMANENT_FAILED.equals(status) ||
            SchedulerState.CANCELLED.equals(status);
    }
}


