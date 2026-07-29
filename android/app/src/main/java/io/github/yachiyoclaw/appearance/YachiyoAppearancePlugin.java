package io.github.yachiyoclaw.appearance;

import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Color;
import android.view.View;
import android.view.Window;
import android.view.accessibility.AccessibilityManager;
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
    private static final String INTERACTION_STATE_CHANGED_EVENT = "interactionStateChanged";

    private AppearanceSystemBarPolicy.Scheme scheme = AppearanceSystemBarPolicy.Scheme.LIGHT;
    private int navigationContrastColor = AppearanceSystemBarPolicy.parseCssColor(
        AppearanceSystemBarPolicy.DEFAULT_LIGHT_NAVIGATION_COLOR
    );
    private AccessibilityManager accessibilityManager;
    private AccessibilityManager.TouchExplorationStateChangeListener touchExplorationListener;
    private View observedDecorView;
    private InteractionState lastInteractionState;
    private boolean destroyed;

    @Override
    public void load() {
        getActivity().runOnUiThread(() -> {
            destroyed = false;
            Window window = getActivity().getWindow();
            observedDecorView = window.getDecorView();
            accessibilityManager = (AccessibilityManager) getContext().getSystemService(Context.ACCESSIBILITY_SERVICE);
            touchExplorationListener = enabled -> runOnUiThreadIfActive(this::refreshAndNotifyInteractionState);
            if (accessibilityManager != null) {
                accessibilityManager.addTouchExplorationStateChangeListener(touchExplorationListener);
            }
            ViewCompat.setOnApplyWindowInsetsListener(observedDecorView, (view, insets) -> {
                if (destroyed) return insets;
                applyCurrentAppearance(insets);
                notifyInteractionStateIfChanged(interactionState(insets));
                return insets;
            });
            applyCurrentAppearance();
            ViewCompat.requestApplyInsets(observedDecorView);
            observedDecorView.post(this::refreshAndNotifyInteractionState);
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
            InteractionState interactionState = applyCurrentAppearance();
            JSObject result = new JSObject();
            result.put("applied", true);
            result.put("edgeToEdge", true);
            putInteractionState(result, interactionState);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void getInteractionState(PluginCall call) {
        getActivity().runOnUiThread(() -> call.resolve(interactionStateJson(currentInteractionState())));
    }

    @Override
    protected void handleOnResume() {
        runOnUiThreadIfActive(this::refreshAndNotifyInteractionState);
    }

    @Override
    protected void handleOnConfigurationChanged(Configuration newConfig) {
        getActivity().runOnUiThread(() -> {
            View decorView = getActivity().getWindow().getDecorView();
            ViewCompat.requestApplyInsets(decorView);
            decorView.post(this::refreshAndNotifyInteractionState);
        });
    }

    @Override
    protected void handleOnDestroy() {
        destroyed = true;
        if (accessibilityManager != null && touchExplorationListener != null) {
            accessibilityManager.removeTouchExplorationStateChangeListener(touchExplorationListener);
        }
        if (observedDecorView != null) {
            ViewCompat.setOnApplyWindowInsetsListener(observedDecorView, null);
        }
        accessibilityManager = null;
        touchExplorationListener = null;
        observedDecorView = null;
        lastInteractionState = null;
        super.handleOnDestroy();
    }

    // These setters are deprecated only on API 35+, but remain necessary for Android 11 three-button contrast.
    @SuppressWarnings("deprecation")
    private InteractionState applyCurrentAppearance() {
        return applyCurrentAppearance(ViewCompat.getRootWindowInsets(getActivity().getWindow().getDecorView()));
    }

    @SuppressWarnings("deprecation")
    private InteractionState applyCurrentAppearance(WindowInsetsCompat windowInsets) {
        Window window = getActivity().getWindow();
        View decorView = window.getDecorView();
        WindowCompat.setDecorFitsSystemWindows(window, false);

        InteractionState interactionState = interactionState(windowInsets);
        AppearanceSystemBarPolicy.NavigationMode navigationMode = interactionState.navigationMode;
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
        return interactionState;
    }

    private InteractionState currentInteractionState() {
        View decorView = getActivity().getWindow().getDecorView();
        return interactionState(ViewCompat.getRootWindowInsets(decorView));
    }

    private InteractionState interactionState(WindowInsetsCompat windowInsets) {
        boolean touchExplorationEnabled = accessibilityManager != null && accessibilityManager.isTouchExplorationEnabled();
        float density = getContext().getResources().getDisplayMetrics().density;
        if (windowInsets == null) {
            return new InteractionState(
                AppearanceSystemBarPolicy.NavigationMode.UNKNOWN,
                0,
                0,
                density,
                touchExplorationEnabled
            );
        }
        Insets navigationBars = windowInsets.getInsets(WindowInsetsCompat.Type.navigationBars());
        Insets tappableElements = windowInsets.getInsets(WindowInsetsCompat.Type.tappableElement());
        Insets systemGestures = windowInsets.getInsets(WindowInsetsCompat.Type.systemGestures());
        return new InteractionState(
            AppearanceSystemBarPolicy.navigationMode(maximumInset(navigationBars), maximumInset(tappableElements)),
            systemGestures.left,
            systemGestures.right,
            density,
            touchExplorationEnabled
        );
    }

    private static int maximumInset(Insets insets) {
        return Math.max(Math.max(insets.left, insets.right), Math.max(insets.top, insets.bottom));
    }

    private void refreshAndNotifyInteractionState() {
        if (destroyed || getActivity() == null) return;
        InteractionState interactionState = applyCurrentAppearance();
        notifyInteractionStateIfChanged(interactionState);
    }

    private void notifyInteractionStateIfChanged(InteractionState interactionState) {
        if (interactionState.equals(lastInteractionState)) return;
        lastInteractionState = interactionState;
        notifyListeners(INTERACTION_STATE_CHANGED_EVENT, interactionStateJson(interactionState));
    }

    private void runOnUiThreadIfActive(Runnable action) {
        if (destroyed || getActivity() == null) return;
        getActivity().runOnUiThread(() -> {
            if (!destroyed) action.run();
        });
    }

    private static JSObject interactionStateJson(InteractionState state) {
        JSObject result = new JSObject();
        putInteractionState(result, state);
        return result;
    }

    private static void putInteractionState(JSObject result, InteractionState state) {
        JSObject gestureInsets = new JSObject();
        gestureInsets.put(
            "left",
            AppearanceSystemBarPolicy.cssPixels(state.systemGestureInsetLeft, state.density)
        );
        gestureInsets.put(
            "right",
            AppearanceSystemBarPolicy.cssPixels(state.systemGestureInsetRight, state.density)
        );
        result.put("navigationMode", state.navigationMode.bridgeValue());
        result.put("systemGestureInsetsCssPx", gestureInsets);
        result.put("touchExplorationEnabled", state.touchExplorationEnabled);
    }

    private static final class InteractionState {
        final AppearanceSystemBarPolicy.NavigationMode navigationMode;
        final int systemGestureInsetLeft;
        final int systemGestureInsetRight;
        final float density;
        final boolean touchExplorationEnabled;

        InteractionState(
            AppearanceSystemBarPolicy.NavigationMode navigationMode,
            int systemGestureInsetLeft,
            int systemGestureInsetRight,
            float density,
            boolean touchExplorationEnabled
        ) {
            this.navigationMode = navigationMode;
            this.systemGestureInsetLeft = systemGestureInsetLeft;
            this.systemGestureInsetRight = systemGestureInsetRight;
            this.density = density;
            this.touchExplorationEnabled = touchExplorationEnabled;
        }

        @Override
        public boolean equals(Object other) {
            if (this == other) return true;
            if (!(other instanceof InteractionState)) return false;
            InteractionState state = (InteractionState) other;
            return navigationMode == state.navigationMode
                && systemGestureInsetLeft == state.systemGestureInsetLeft
                && systemGestureInsetRight == state.systemGestureInsetRight
                && Float.compare(density, state.density) == 0
                && touchExplorationEnabled == state.touchExplorationEnabled;
        }

        @Override
        public int hashCode() {
            int result = navigationMode.hashCode();
            result = 31 * result + systemGestureInsetLeft;
            result = 31 * result + systemGestureInsetRight;
            result = 31 * result + Float.hashCode(density);
            return 31 * result + Boolean.hashCode(touchExplorationEnabled);
        }
    }
}
