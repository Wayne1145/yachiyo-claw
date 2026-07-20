package io.github.yachiyoclaw.agent;

import java.util.Locale;

/** Pure OEM routing table; actual Intent resolution remains best-effort and user initiated. */
public final class BackgroundSettingsPolicy {
    private BackgroundSettingsPolicy() {}

    public static String[][] candidates(String manufacturer) {
        String vendor = manufacturer == null ? "" : manufacturer.toLowerCase(Locale.ROOT);
        if (vendor.contains("xiaomi") || vendor.contains("redmi")) {
            return entries(
                "com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"
            );
        }
        if (vendor.contains("huawei")) {
            return entries(
                "com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
                "com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"
            );
        }
        if (vendor.contains("honor")) {
            return entries(
                "com.hihonor.systemmanager", "com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity"
            );
        }
        if (vendor.contains("oppo") || vendor.contains("realme") || vendor.contains("oneplus")) {
            return entries(
                "com.oplus.safecenter", "com.oplus.safecenter.startupapp.StartupAppListActivity",
                "com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"
            );
        }
        if (vendor.contains("vivo") || vendor.contains("iqoo")) {
            return entries(
                "com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity",
                "com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"
            );
        }
        if (vendor.contains("samsung")) {
            return entries("com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity");
        }
        if (vendor.contains("asus")) {
            return entries("com.asus.mobilemanager", "com.asus.mobilemanager.entry.FunctionActivity");
        }
        if (vendor.contains("meizu")) {
            return entries("com.meizu.safe", "com.meizu.safe.permission.SmartBGActivity");
        }
        return new String[0][0];
    }

    private static String[][] entries(String... values) {
        String[][] result = new String[values.length / 2][2];
        for (int index = 0; index < values.length; index += 2) {
            result[index / 2][0] = values[index];
            result[index / 2][1] = values[index + 1];
        }
        return result;
    }
}
