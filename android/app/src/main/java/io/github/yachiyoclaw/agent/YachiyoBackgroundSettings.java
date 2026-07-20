package io.github.yachiyoclaw.agent;

import android.content.ComponentName;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

/** Opens OEM background-management pages without claiming their opaque grant state is readable. */
final class YachiyoBackgroundSettings {
    private YachiyoBackgroundSettings() {}

    static boolean hasOemAutoStartPage(Context context) {
        return resolveOemIntent(context) != null;
    }

    static void openAutoStart(Context context) {
        Intent intent = resolveOemIntent(context);
        if (intent == null) {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, packageUri(context));
        }
        if (!start(context, intent)) openAppDetails(context);
    }

    static void openBatteryOptimization(Context context) {
        Intent direct = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, packageUri(context));
        if (direct.resolveActivity(context.getPackageManager()) != null) {
            if (!start(context, direct)) openAppDetails(context);
            return;
        }
        if (!start(context, new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))) {
            openAppDetails(context);
        }
    }

    static void openNotifications(Context context) {
        Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName());
        if (!start(context, intent)) openAppDetails(context);
    }

    private static Intent resolveOemIntent(Context context) {
        for (String[] component : BackgroundSettingsPolicy.candidates(Build.MANUFACTURER)) {
            Intent candidate = new Intent().setComponent(new ComponentName(component[0], component[1]));
            if (candidate.resolveActivity(context.getPackageManager()) != null) return candidate;
        }
        return null;
    }

    private static Uri packageUri(Context context) {
        return Uri.parse("package:" + context.getPackageName());
    }

    private static void openAppDetails(Context context) {
        start(context, new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, packageUri(context)));
    }

    private static boolean start(Context context, Intent intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            context.startActivity(intent);
            return true;
        } catch (ActivityNotFoundException | SecurityException ignored) {
            return false;
        }
    }
}
