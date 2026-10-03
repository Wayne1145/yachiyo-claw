package io.github.yachiyoclaw;

import android.app.Application;
import androidx.appcompat.app.AppCompatDelegate;
import io.github.yachiyoclaw.appearance.YachiyoThemePreference;

public class YachiyoApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        // Apply the user's explicit light/dark choice before any window or
        // splash is created; otherwise the DayNight theme would always paint
        // the system scheme for the first frames even when the user picked
        // the opposite theme in settings.
        AppCompatDelegate.setDefaultNightMode(YachiyoThemePreference.readNightMode(this));
    }
}
