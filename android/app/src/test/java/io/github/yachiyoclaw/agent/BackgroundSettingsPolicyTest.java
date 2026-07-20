package io.github.yachiyoclaw.agent;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class BackgroundSettingsPolicyTest {
    @Test
    public void mapsCommonAndroidVendorsToKnownSettingsComponents() {
        assertEquals("com.miui.securitycenter", BackgroundSettingsPolicy.candidates("Xiaomi")[0][0]);
        assertEquals("com.huawei.systemmanager", BackgroundSettingsPolicy.candidates("HUAWEI")[0][0]);
        assertEquals("com.oplus.safecenter", BackgroundSettingsPolicy.candidates("OnePlus")[0][0]);
        assertEquals("com.vivo.permissionmanager", BackgroundSettingsPolicy.candidates("vivo")[0][0]);
        assertEquals("com.samsung.android.lool", BackgroundSettingsPolicy.candidates("samsung")[0][0]);
    }

    @Test
    public void leavesUnknownVendorsOnTheStandardAppDetailsFallback() {
        assertTrue(BackgroundSettingsPolicy.candidates("generic").length == 0);
    }
}
