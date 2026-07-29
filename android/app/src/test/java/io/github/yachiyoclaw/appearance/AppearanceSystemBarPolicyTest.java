package io.github.yachiyoclaw.appearance;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class AppearanceSystemBarPolicyTest {
    @Test
    public void parsesCssHexColorsWithoutConfusingRgbaAndArgb() {
        assertEquals((int) 0xff123456L, AppearanceSystemBarPolicy.parseCssColor("#123456"));
        assertEquals((int) 0x80123456L, AppearanceSystemBarPolicy.parseCssColor("#12345680"));
        assertThrows(
            IllegalArgumentException.class,
            () -> AppearanceSystemBarPolicy.parseCssColor("rgba(1, 2, 3, .5)")
        );
    }

    @Test
    public void identifiesGestureNavigationFromTheAbsenceOfTappableNavigationInsets() {
        assertEquals(
            AppearanceSystemBarPolicy.NavigationMode.GESTURE,
            AppearanceSystemBarPolicy.navigationMode(24, 0)
        );
        assertEquals(
            AppearanceSystemBarPolicy.NavigationMode.THREE_BUTTON,
            AppearanceSystemBarPolicy.navigationMode(96, 96)
        );
        assertEquals(
            AppearanceSystemBarPolicy.NavigationMode.UNKNOWN,
            AppearanceSystemBarPolicy.navigationMode(0, 0)
        );
    }

    @Test
    public void keepsOnlyGestureNavigationFullyTransparent() {
        int requested = (int) 0xf2f7f9fcL;
        assertEquals(
            0,
            AppearanceSystemBarPolicy.navigationBarColor(
                AppearanceSystemBarPolicy.NavigationMode.GESTURE,
                requested
            )
        );
        assertEquals(
            requested,
            AppearanceSystemBarPolicy.navigationBarColor(
                AppearanceSystemBarPolicy.NavigationMode.THREE_BUTTON,
                requested
            )
        );
        assertFalse(
            AppearanceSystemBarPolicy.requiresNavigationContrast(
                AppearanceSystemBarPolicy.NavigationMode.GESTURE
            )
        );
        assertTrue(
            AppearanceSystemBarPolicy.requiresNavigationContrast(
                AppearanceSystemBarPolicy.NavigationMode.UNKNOWN
            )
        );
    }

    @Test
    public void convertsPhysicalGestureInsetsToCssPixels() {
        assertEquals(24d, AppearanceSystemBarPolicy.cssPixels(72, 3f), 0.0001d);
        assertEquals(0d, AppearanceSystemBarPolicy.cssPixels(0, 3f), 0.0001d);
        assertEquals(72d, AppearanceSystemBarPolicy.cssPixels(72, 0f), 0.0001d);
    }
}
