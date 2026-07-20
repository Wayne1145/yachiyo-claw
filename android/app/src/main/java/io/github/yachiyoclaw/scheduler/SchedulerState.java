package io.github.yachiyoclaw.scheduler;

/** Stable persisted states shared by the Room store, Worker and Capacitor bridge. */
public final class SchedulerState {
    public static final int SCHEMA_VERSION = 1;

    public static final String SCHEDULED = "scheduled";
    public static final String CLAIMED = "claimed";
    public static final String RUNNING = "running";
    public static final String PAUSED = "paused";
    public static final String AWAITING_APPROVAL = "awaiting-approval";
    public static final String AWAITING_FOREGROUND = "awaiting-foreground";
    public static final String SUCCEEDED = "succeeded";
    public static final String RETRYABLE_FAILED = "retryable-failed";
    public static final String PERMANENT_FAILED = "permanent-failed";
    public static final String CANCELLED = "cancelled";

    public static final String OUTBOX_WAKE = "schedule_wake";
    public static final long LEASE_DURATION_MS = 5 * 60 * 1000L;
    public static final long OUTBOX_LEASE_DURATION_MS = 5 * 60 * 1000L;
    public static final int MAX_ATTEMPTS = 5;

    private SchedulerState() {}
}


