package io.github.yachiyoclaw.appearance;

import android.content.res.Configuration;
import android.graphics.Color;
import android.view.View;
import android.view.Window;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "YachiyoAppearance")
public final class YachiyoAppearancePlugin extends Plugin {
    private AppearanceSystemBarPolicy.Scheme scheme = AppearanceSystemBarPolicy.Scheme.LIGHT;
    private int navigationContrastColor = AppearanceSystemBarPolicy.parseCssColor(
        AppearanceSystemBarPolicy.DEFAULT_LIGHT_NAVIGATION_COLOR
    );

    @Override
    public void load() {
        getActivity().runOnUiThread(() -> {
            applyCurrentAppearance();
            View decorView = getActivity().getWindow().getDecorView();
            ViewCompat.requestApplyInsets(decorView);
            decorView.post(this::applyCurrentAppearance);
        });
    }

    @PluginMethod
    public void setSystemBars(PluginCall call) {
        final AppearanceSystemBarPolicy.Scheme requestedScheme;
        final int requestedNavigationColor;
        try {
            requestedScheme = AppearanceSystemBarPolicy.parseScheme(call.getString("scheme"));
            String fallback = requestedScheme == AppearanceSystemBarPolicy.Scheme.LIGHT
                ? AppearanceSystemBarPolicy.DEFAULT_LIGHT_NAVIGATION_COLOR
                : AppearanceSystemBarPolicy.DEFAULT_DARK_NAVIGATION_COLOR;
            requestedNavigationColor = AppearanceSystemBarPolicy.parseCssColor(
                call.getString("navigationBarColor", fallback)
            );
        } catch (IllegalArgumentException error) {
            call.reject(error.getMessage(), error);
            return;
        }

        getActivity().runOnUiThread(() -> {
            scheme = requestedScheme;
            navigationContrastColor = requestedNavigationColor;
            AppearanceSystemBarPolicy.NavigationMode navigationMode = applyCurrentAppearance();
            JSObject result = new JSObject();
            result.put("applied", true);
            result.put("edgeToEdge", true);
            result.put("navigationMode", navigationMode.bridgeValue());
            call.resolve(result);
        });
    }

    @Override
    protected void handleOnResume() {
        getActivity().runOnUiThread(this::applyCurrentAppearance);
    }

    @Override
    protected void handleOnConfigurationChanged(Configuration newConfig) {
        getActivity().runOnUiThread(() -> {
            View decorView = getActivity().getWindow().getDecorView();
            ViewCompat.requestApplyInsets(decorView);
            decorView.post(this::applyCurrentAppearance);
        });
    }

    // These setters are deprecated only on API 35+, but remain necessary for Android 11 three-button contrast.
    @SuppressWarnings("deprecation")
    private AppearanceSystemBarPolicy.NavigationMode applyCurrentAppearance() {
        Window window = getActivity().getWindow();
        View decorView = window.getDecorView();
        WindowCompat.setDecorFitsSystemWindows(window, false);

        AppearanceSystemBarPolicy.NavigationMode navigationMode = navigationMode(decorView);
        boolean useDarkIcons = scheme == AppearanceSystemBarPolicy.Scheme.LIGHT;
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, decorView);
        controller.setAppearanceLightStatusBars(useDarkIcons);
        controller.setAppearanceLightNavigationBars(useDarkIcons);

        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(
            AppearanceSystemBarPolicy.navigationBarColor(navigationMode, navigationContrastColor)
        );
        window.setNavigationBarContrastEnforced(
            AppearanceSystemBarPolicy.requiresNavigationContrast(navigationMode)
        );
        return navigationMode;
    }

    private static AppearanceSystemBarPolicy.NavigationMode navigationMode(View decorView) {
        WindowInsetsCompat windowInsets = ViewCompat.getRootWindowInsets(decorView);
        if (windowInsets == null) return AppearanceSystemBarPolicy.NavigationMode.UNKNOWN;
        Insets navigationBars = windowInsets.getInsets(WindowInsetsCompat.Type.navigationBars());
        Insets tappableElements = windowInsets.getInsets(WindowInsetsCompat.Type.tappableElement());
        return AppearanceSystemBarPolicy.navigationMode(navigationBars.bottom, tappableElements.bottom);
    }
}
