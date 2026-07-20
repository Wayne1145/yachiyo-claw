package io.github.yachiyoclaw.scheduler;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/** Android-free policy for broadcasts that must rebuild persisted WorkManager requests. */
public final class SchedulerRecoveryPolicy {
    public static final String BOOT_COMPLETED = "android.intent.action.BOOT_COMPLETED";
    public static final String LOCKED_BOOT_COMPLETED = "android.intent.action.LOCKED_BOOT_COMPLETED";
    public static final String USER_UNLOCKED = "android.intent.action.USER_UNLOCKED";
    public static final String PACKAGE_REPLACED = "android.intent.action.MY_PACKAGE_REPLACED";
    public static final String TIME_SET = "android.intent.action.TIME_SET";
    public static final String TIMEZONE_CHANGED = "android.intent.action.TIMEZONE_CHANGED";

    private static final Set<String> RECOVERY_ACTIONS = new HashSet<>(Arrays.asList(
        BOOT_COMPLETED,
        LOCKED_BOOT_COMPLETED,
        USER_UNLOCKED,
        PACKAGE_REPLACED,
        TIME_SET,
        TIMEZONE_CHANGED
    ));

    private SchedulerRecoveryPolicy() {}

    public static boolean supports(String action) {
        return action != null && RECOVERY_ACTIONS.contains(action);
    }

    /** Room and Keystore are credential-protected, so locked boot is recorded and deferred. */
    public static boolean shouldReconcile(String action, boolean userUnlocked) {
        return supports(action) && userUnlocked;
    }

    public static boolean replacesExistingWork(String action) {
        return TIME_SET.equals(action) || TIMEZONE_CHANGED.equals(action) || PACKAGE_REPLACED.equals(action);
    }
}
