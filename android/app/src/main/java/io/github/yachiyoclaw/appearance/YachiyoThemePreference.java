package io.github.yachiyoclaw.appearance;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.appcompat.app.AppCompatDelegate;

/** Persists the in-app light/dark/system setting natively so the window theme
 *  (including the splash background) matches the WebView from the first frame. */
public final class YachiyoThemePreference {
    public static final String PREFS_NAME = "yachiyo_appearance";
    public static final String KEY_THEME = "theme";

    private YachiyoThemePreference() {}

    public static int readNightMode(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return nightModeFor(prefs.getString(KEY_THEME, "system"));
    }

    public static void write(Context context, String theme) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_THEME, theme)
            .apply();
    }

    public static int nightModeFor(String theme) {
        if ("light".equals(theme)) return AppCompatDelegate.MODE_NIGHT_NO;
        if ("dark".equals(theme)) return AppCompatDelegate.MODE_NIGHT_YES;
        return AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM;
    }
}
