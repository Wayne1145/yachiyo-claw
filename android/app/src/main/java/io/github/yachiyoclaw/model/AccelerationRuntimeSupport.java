package io.github.yachiyoclaw.model;

import android.content.Context;
import android.os.Build;
import android.os.PowerManager;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;

/** Device probes used before a native backend is allowed to initialize. */
final class AccelerationRuntimeSupport {
    private AccelerationRuntimeSupport() {}

    static List<String> liteRtCandidates(Context context, String modelPath, boolean declaredNpuCompatible) {
        List<String> candidates = new ArrayList<>();
        if (npuLibraryDir(context, modelPath, declaredNpuCompatible) != null) candidates.add(AccelerationPolicy.BACKEND_NPU);
        candidates.add(AccelerationPolicy.BACKEND_GPU);
        candidates.add(AccelerationPolicy.BACKEND_CPU);
        return candidates;
    }

    static String npuLibraryDir(Context context, String modelPath, boolean declaredNpuCompatible) {
        if (!declaredNpuCompatible || Build.SUPPORTED_ABIS == null) return null;
        boolean arm64 = false;
        for (String abi : Build.SUPPORTED_ABIS) if ("arm64-v8a".equals(abi)) arm64 = true;
        if (!arm64) return null;

        File directory = npuDispatchDirectory(context);
        if (directory == null) return null;
        if (!modelMatchesSoc(modelPath, socModel())) return null;
        return directory.getPath();
    }

    static File npuDispatchDirectory(Context context) {
        File directory = new File(context.getApplicationInfo().nativeLibraryDir == null
            ? "" : context.getApplicationInfo().nativeLibraryDir);
        File[] files = directory.listFiles();
        boolean dispatch = false;
        if (files != null) for (File file : files) {
            String name = file.getName().toLowerCase(Locale.ROOT);
            if (name.endsWith(".so") && name.contains("dispatch")) dispatch = true;
        }
        return dispatch ? directory : null;
    }

    static boolean modelMatchesSoc(String modelPath, String soc) {
        String modelToken = token(new File(modelPath == null ? "" : modelPath).getName());
        String[] parts = (soc == null ? "" : soc).toLowerCase(Locale.ROOT).split("[^a-z0-9]+");
        String best = "";
        for (String part : parts) if (containsDigit(part) && part.length() > best.length()) best = part;
        if (best.isEmpty()) for (String part : parts) if (part.length() > best.length()) best = part;
        return best.length() >= 3 && modelToken.contains(best);
    }

    static boolean declaredSocMatches(JSONArray declaredSocModels, String actualSoc) {
        if (declaredSocModels == null) return false;
        List<String> values = new ArrayList<>();
        for (int index = 0; index < declaredSocModels.length(); index++) values.add(declaredSocModels.optString(index));
        return declaredSocMatches(values, actualSoc);
    }

    static boolean declaredSocMatches(List<String> declaredSocModels, String actualSoc) {
        if (declaredSocModels == null) return false;
        String actual = token(actualSoc);
        for (String declared : declaredSocModels) {
            String expected = token(declared);
            if (expected.length() >= 3 && (actual.equals(expected) || actual.endsWith(expected))) return true;
        }
        return false;
    }

    static boolean declaredVendorMatches(String vendor, String actualSoc) {
        String expected = token(vendor);
        String actual = token(actualSoc);
        if ("qualcomm".equals(expected)) return actual.contains("qualcomm") || actual.contains("qti") || actual.contains("snapdragon");
        if ("mediatek".equals(expected)) return actual.contains("mediatek") || actual.contains("dimensity") || actual.startsWith("mt");
        if ("google".equals(expected)) return actual.contains("google") || actual.contains("tensor");
        if ("samsung".equals(expected)) return actual.contains("samsung") || actual.contains("exynos");
        return false;
    }

    static boolean thermallySafe(Context context) {
        if (Build.VERSION.SDK_INT < 29) return true;
        PowerManager manager = context.getSystemService(PowerManager.class);
        return manager == null || manager.getCurrentThermalStatus() < PowerManager.THERMAL_STATUS_SEVERE;
    }

    static boolean canContinueBenchmark(Context context, String mode) {
        int stopAt = AccelerationPolicy.MODE_EXTREME.equals(AccelerationPolicy.normalizeMode(mode))
            ? PowerManager.THERMAL_STATUS_SEVERE
            : PowerManager.THERMAL_STATUS_MODERATE;
        return thermalStatus(context) < stopAt;
    }

    static int thermalStatus(Context context) {
        if (Build.VERSION.SDK_INT < 29) return PowerManager.THERMAL_STATUS_NONE;
        PowerManager manager = context.getSystemService(PowerManager.class);
        return manager == null ? PowerManager.THERMAL_STATUS_NONE : manager.getCurrentThermalStatus();
    }

    static int[] cpuThreadCandidates() {
        int processors = Math.max(1, Runtime.getRuntime().availableProcessors());
        int performance = Math.max(1, processors / 2);
        int capped = Math.min(8, processors);
        if (performance == capped && capped == processors) return new int[] {processors};
        if (performance == capped) return new int[] {performance, processors};
        if (capped == processors) return new int[] {performance, processors};
        return new int[] {performance, capped, processors};
    }

    static int preferredCpuThreads() {
        return cpuThreadCandidates()[0];
    }

    static String deviceIdentity() {
        return Build.FINGERPRINT + "|" + socModel() + "|" + Build.HARDWARE + "|" + Build.VERSION.SDK_INT;
    }

    static String socModel() {
        return Build.VERSION.SDK_INT >= 31 ? Build.SOC_MANUFACTURER + " " + Build.SOC_MODEL : Build.HARDWARE;
    }

    private static String token(String value) {
        return (value == null ? "" : value).toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
    }

    private static boolean containsDigit(String value) {
        for (int index = 0; index < value.length(); index++) if (Character.isDigit(value.charAt(index))) return true;
        return false;
    }
}
