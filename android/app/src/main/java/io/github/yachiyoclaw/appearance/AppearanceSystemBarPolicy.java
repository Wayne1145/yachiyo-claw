package io.github.yachiyoclaw.appearance;

final class AppearanceSystemBarPolicy {
    static final String DEFAULT_LIGHT_NAVIGATION_COLOR = "#F7F9FCF2";
    static final String DEFAULT_DARK_NAVIGATION_COLOR = "#15191FF2";

    enum Scheme {
        LIGHT,
        DARK
    }

    enum NavigationMode {
        GESTURE("gesture"),
        THREE_BUTTON("three-button"),
        UNKNOWN("unknown");

        private final String bridgeValue;

        NavigationMode(String bridgeValue) {
            this.bridgeValue = bridgeValue;
        }

        String bridgeValue() {
            return bridgeValue;
        }
    }

    private AppearanceSystemBarPolicy() {}

    static Scheme parseScheme(String value) {
        if ("light".equals(value)) return Scheme.LIGHT;
        if ("dark".equals(value)) return Scheme.DARK;
        throw new IllegalArgumentException("appearance_scheme_invalid");
    }

    /** Parses CSS #RRGGBB and #RRGGBBAA values into Android ARGB. */
    static int parseCssColor(String value) {
        if (value == null || !value.matches("#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?")) {
            throw new IllegalArgumentException("appearance_navigation_color_invalid");
        }
        long rgb = Long.parseLong(value.substring(1, 7), 16);
        long alpha = value.length() == 9 ? Long.parseLong(value.substring(7, 9), 16) : 0xffL;
        return (int) ((alpha << 24) | rgb);
    }

    static NavigationMode navigationMode(int navigationBarBottom, int tappableElementBottom) {
        if (navigationBarBottom <= 0) return NavigationMode.UNKNOWN;
        return tappableElementBottom > 0 ? NavigationMode.THREE_BUTTON : NavigationMode.GESTURE;
    }

    static int navigationBarColor(NavigationMode mode, int requestedContrastColor) {
        return mode == NavigationMode.GESTURE ? 0x00000000 : requestedContrastColor;
    }

    static boolean requiresNavigationContrast(NavigationMode mode) {
        // Unknown is deliberately conservative until the first root-insets pass completes.
        return mode != NavigationMode.GESTURE;
    }

    static double cssPixels(int physicalPixels, float density) {
        if (physicalPixels <= 0) return 0d;
        float safeDensity = density > 0f ? density : 1f;
        return physicalPixels / (double) safeDensity;
    }
}
