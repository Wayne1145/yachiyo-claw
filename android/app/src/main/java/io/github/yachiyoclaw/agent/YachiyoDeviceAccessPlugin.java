package io.github.yachiyoclaw.agent;

import android.content.Context;
import android.content.BroadcastReceiver;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.res.Configuration;
import android.content.pm.ActivityInfo;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.RectF;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.os.PowerManager;
import android.os.Build;
import android.provider.Settings;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.DecelerateInterpolator;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import moe.shizuku.server.IShizukuService;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import rikka.shizuku.Shizuku;

@CapacitorPlugin(name = "YachiyoDeviceAccess")
public class YachiyoDeviceAccessPlugin extends Plugin {

    private static final Locale[] APP_LABEL_LOCALES = new Locale[] {
        Locale.SIMPLIFIED_CHINESE,
        Locale.TRADITIONAL_CHINESE,
        Locale.ENGLISH,
    };

    private static final int SHIZUKU_REQUEST_CODE = 8_000;
    private static final int MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private Shizuku.OnRequestPermissionResultListener permissionListener;
    private WindowManager windowManager;
    private View edgeGlowView;
    private LinearLayout capsuleRoot;
    private TextView streamText;
    private LinearLayout approvalRoot;
    private PluginCall pendingApprovalCall;
    private BroadcastReceiver packageChangeReceiver;

    @Override
    public void load() {
        super.load();
        packageChangeReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                JSObject event = new JSObject();
                event.put("action", intent.getAction() == null ? "" : intent.getAction());
                event.put("packageName", intent.getData() == null ? "" : intent.getData().getSchemeSpecificPart());
                event.put("observedAt", System.currentTimeMillis());
                // Retain the invalidation until the renderer installs its lazy listener.
                notifyListeners("launchableAppsChanged", event, true);
            }
        };
        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_PACKAGE_ADDED);
        filter.addAction(Intent.ACTION_PACKAGE_REMOVED);
        filter.addAction(Intent.ACTION_PACKAGE_REPLACED);
        filter.addAction(Intent.ACTION_PACKAGE_CHANGED);
        filter.addDataScheme("package");
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                getContext().registerReceiver(packageChangeReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                getContext().registerReceiver(packageChangeReceiver, filter);
            }
        } catch (RuntimeException ignored) {
            packageChangeReceiver = null;
        }
    }

    @PluginMethod
    public void getPermissionStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("overlay", Settings.canDrawOverlays(getContext()));
        PowerManager powerManager = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        result.put("batteryOptimizationIgnored", powerManager.isIgnoringBatteryOptimizations(getContext().getPackageName()));
        result.put("allFiles", Environment.isExternalStorageManager());
        result.put("accessibility", isAccessibilityEnabled());
        result.put("shizukuInstalled", isPackageInstalled("moe.shizuku.privileged.api"));
        result.put("shizukuRunning", isShizukuRunning());
        result.put("shizukuGranted", hasShizukuPermission());
        call.resolve(result);
    }

    @PluginMethod
    public void openPermissionSettings(PluginCall call) {
        String target = call.getString("target", "");
        Intent intent;
        switch (target) {
            case "overlay":
                intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, packageUri());
                break;
            case "battery":
                intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, packageUri());
                break;
            case "storage":
                intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, packageUri());
                break;
            case "accessibility":
                intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
                break;
            case "shizuku":
                intent = getContext().getPackageManager().getLaunchIntentForPackage("moe.shizuku.privileged.api");
                if (intent == null) {
                    intent = new Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/RikkaApps/Shizuku/releases"));
                }
                break;
            default:
                call.reject("unknown_permission_target");
                return;
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void requestShizukuPermission(PluginCall call) {
        if (!isShizukuRunning()) {
            call.reject("shizuku_not_running");
            return;
        }
        if (hasShizukuPermission()) {
            JSObject result = new JSObject();
            result.put("granted", true);
            call.resolve(result);
            return;
        }
        if (permissionListener != null) Shizuku.removeRequestPermissionResultListener(permissionListener);
        permissionListener = (requestCode, grantResult) -> {
            if (requestCode != SHIZUKU_REQUEST_CODE) return;
            JSObject result = new JSObject();
            result.put("granted", grantResult == PackageManager.PERMISSION_GRANTED);
            call.resolve(result);
            Shizuku.removeRequestPermissionResultListener(permissionListener);
            permissionListener = null;
        };
        Shizuku.addRequestPermissionResultListener(permissionListener);
        Shizuku.requestPermission(SHIZUKU_REQUEST_CODE);
    }

    @PluginMethod
    public void execShizuku(PluginCall call) {
        String command = call.getString("command", "").trim();
        int timeout = Math.max(1_000, Math.min(call.getInt("timeout", 120_000), 120_000));
        if (command.isEmpty() || command.length() > 32_768) {
            call.reject("invalid_command");
            return;
        }
        executor.submit(() -> {
            try {
                call.resolve(executeShizuku(command, timeout));
            } catch (Exception error) {
                call.reject("shizuku_execution_failed", error);
            }
        });
    }

    /**
     * Enumerate launcher activities locally. This is deliberately independent
     * from AccessibilityService so an app can be resolved before the service
     * navigates anywhere (and without sending a HOME/search loop to a model).
     */
    @PluginMethod
    public void listLaunchableApps(PluginCall call) {
        try {
            List<LaunchableAppRecord> records = queryLaunchableApps();
            long observedAt = System.currentTimeMillis();
            JSONArray apps = new JSONArray();
            for (LaunchableAppRecord record : records) apps.put(record.toJson(observedAt));
            JSObject result = new JSObject();
            result.put("apps", apps);
            result.put("count", records.size());
            result.put("observedAt", System.currentTimeMillis());
            call.resolve(result);
        } catch (RuntimeException error) {
            call.reject("launchable_apps_unavailable");
        }
    }

    /** Read the stable launcher/display fields needed to validate an icon cache. */
    @PluginMethod
    public void getLauncherContext(PluginCall call) {
        try {
            PackageManager packageManager = getContext().getPackageManager();
            Intent homeIntent = new Intent(Intent.ACTION_MAIN);
            homeIntent.addCategory(Intent.CATEGORY_HOME);
            ResolveInfo home = packageManager.resolveActivity(homeIntent, PackageManager.MATCH_DEFAULT_ONLY);
            if (home == null || home.activityInfo == null || !isValidPackageName(home.activityInfo.packageName)) {
                call.reject("launcher_context_unavailable");
                return;
            }
            String launcherPackage = home.activityInfo.packageName;
            long launcherVersionCode = Build.VERSION.SDK_INT >= 28
                ? packageManager.getPackageInfo(launcherPackage, 0).getLongVersionCode()
                : packageManager.getPackageInfo(launcherPackage, 0).versionCode;
            android.util.DisplayMetrics metrics = getContext().getResources().getDisplayMetrics();
            int displayId = 0;
            if (getActivity() != null && getActivity().getDisplay() != null) {
                displayId = getActivity().getDisplay().getDisplayId();
            }
            String orientation = getContext().getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE
                ? "landscape"
                : "portrait";
            JSObject result = new JSObject();
            result.put("launcherPackage", launcherPackage);
            result.put("launcherVersionCode", launcherVersionCode);
            result.put("displayId", displayId);
            result.put("orientation", orientation);
            result.put("density", metrics.density);
            result.put("densityDpi", metrics.densityDpi);
            result.put("widthPixels", metrics.widthPixels);
            result.put("heightPixels", metrics.heightPixels);
            call.resolve(result);
        } catch (PackageManager.NameNotFoundException | RuntimeException error) {
            call.reject("launcher_context_unavailable");
        }
    }

    /**
     * Resolve a user-facing app name/package using only local PackageManager
     * metadata. The caller receives ranked candidates so ambiguous labels can
     * be confirmed without any model exploration.
     */
    @PluginMethod
    public void resolveLaunchableApp(PluginCall call) {
        String query = call.getString("query", "");
        if (query == null || query.trim().isEmpty() || query.length() > 256) {
            call.reject("invalid_app_query");
            return;
        }
        String expected = normalizeAppQuery(query);
        List<ScoredLaunchableApp> matches = new ArrayList<>();
        for (LaunchableAppRecord record : queryLaunchableApps()) {
            int score = appMatchScore(record, expected);
            if (score > 0) matches.add(new ScoredLaunchableApp(record, score));
        }
        Collections.sort(matches, (left, right) -> {
            int score = Integer.compare(right.score, left.score);
            return score != 0 ? score : left.record.label.compareToIgnoreCase(right.record.label);
        });

        JSONArray candidates = new JSONArray();
        int limit = Math.min(matches.size(), 32);
        long observedAt = System.currentTimeMillis();
        for (int index = 0; index < limit; index++) candidates.put(matches.get(index).record.toJson(observedAt));
        JSObject result = new JSObject();
        result.put("query", query.trim());
        result.put("matches", candidates);
        result.put("ambiguous", matches.size() > 1 && matches.get(0).score == matches.get(1).score);
        if (matches.size() == 1 || (matches.size() > 0 && matches.get(0).score > matches.get(1).score)) {
            result.put("selected", matches.get(0).record.toJson(observedAt));
        }
        call.resolve(result);
    }

    /** Direct PackageManager launch used by the local app index. */
    @PluginMethod
    public void launchApp(PluginCall call) {
        launchPackage(call, call.getString("packageName", ""), call.getString("activityName", ""));
    }

    @PluginMethod
    public void accessibilityAction(PluginCall call) {
        String action = call.getString("action", "");

        // PackageManager launching does not require an active accessibility
        // service. Keep this old action usable during permission setup.
        if ("launch".equals(action)) {
            launchPackage(call, call.getString("packageName", ""), call.getString("activityName", ""));
            return;
        }

        YachiyoAccessibilityService service = YachiyoAccessibilityService.getInstance();
        if (service == null) {
            call.reject("accessibility_not_running");
            return;
        }
        JSObject result = new JSObject();
        switch (action) {
            case "observe":
                String legacy = service.observe();
                result.put("success", true);
                // Keep the compatibility XML path bounded as well; semantic
                // observation is the preferred model-facing contract.
                result.put(
                    "output",
                    legacy.getBytes(StandardCharsets.UTF_8).length <= YachiyoAccessibilityService.SEMANTIC_MAX_BYTES
                        ? legacy
                        : "<hierarchy truncated=\"true\" />"
                );
                break;
            case "observeSemantic":
                String semantic = service.observeSemantic();
                result.put("success", true);
                result.put("output", semantic);
                result.put("bytes", semantic.getBytes(StandardCharsets.UTF_8).length);
                break;
            case "findNode":
                YachiyoAccessibilityService.AccessibilitySelector findSelector = selectorFromCall(call);
                YachiyoAccessibilityService.NodeFindResult findResult = service.findNodeResult(findSelector);
                result.put("success", findResult.found);
                result.put("found", findResult.found);
                if (findResult.ambiguous) {
                    result.put("ambiguous", true);
                    result.put("reason", "node_ambiguous");
                }
                if (findResult.found) result.put("output", findResult.node);
                break;
            case "clickNode":
                putNodeActionResult(result, service.clickNode(selectorFromCall(call)));
                break;
            case "setNodeText":
                String nodeText = call.getString("text", "");
                if (nodeText == null || nodeText.length() > 16_000) {
                    call.reject("invalid_accessibility_text");
                    return;
                }
                putNodeActionResult(result, service.setNodeText(selectorFromCall(call, true), nodeText));
                break;
            case "scrollNode":
                putNodeActionResult(result, service.scrollNode(selectorFromCall(call), call.getString("direction", "")));
                break;
            case "tap":
                result.put("success", service.tap(call.getFloat("x", 0f), call.getFloat("y", 0f)));
                break;
            case "swipe":
                result.put(
                    "success",
                    service.swipe(
                        call.getFloat("startX", 0f),
                        call.getFloat("startY", 0f),
                        call.getFloat("endX", 0f),
                        call.getFloat("endY", 0f),
                        call.getLong("duration", 350L)
                    )
                );
                break;
            case "text":
                result.put("success", service.setText(call.getString("text", "")));
                break;
            case "global":
                result.put("success", service.globalAction(call.getString("key", "")));
                break;
            default:
                call.reject("unknown_accessibility_action");
                return;
        }
        call.resolve(result);
    }

    private void launchPackage(PluginCall call, String packageName, String activityName) {
        if (!isValidPackageName(packageName)) {
            call.reject("invalid_package_name");
            return;
        }
        PackageManager packageManager = getContext().getPackageManager();
        Intent launch = packageManager.getLaunchIntentForPackage(packageName);
        String normalizedActivity = activityName == null ? "" : activityName.trim();
        if (!normalizedActivity.isEmpty() && normalizedActivity.length() <= 300) {
            ActivityInfo launcherActivity = findLauncherActivity(packageManager, packageName, normalizedActivity);
            if (launcherActivity != null) {
                Intent explicit = new Intent(Intent.ACTION_MAIN);
                explicit.addCategory(Intent.CATEGORY_LAUNCHER);
                explicit.setClassName(packageName, launcherActivity.name);
                launch = explicit;
            }
        }
        boolean started = false;
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                getContext().startActivity(launch);
                started = true;
            } catch (RuntimeException ignored) {}
        }
        JSObject result = new JSObject();
        result.put("success", started);
        result.put("packageName", packageName);
        call.resolve(result);
    }

    /**
     * Only accept an explicit activity that PackageManager currently exposes as
     * a MAIN/LAUNCHER entry. A stale or caller-supplied exported activity must
     * never broaden the launch surface beyond the local app index.
     */
    private static ActivityInfo findLauncherActivity(
        PackageManager packageManager,
        String packageName,
        String activityName
    ) {
        String requestedName = canonicalActivityName(packageName, activityName);
        try {
            for (ResolveInfo resolveInfo : queryLauncherActivities(packageManager)) {
                ActivityInfo activityInfo = resolveInfo.activityInfo;
                if (activityInfo == null || !packageName.equals(activityInfo.packageName)) continue;
                if (requestedName.equals(activityInfo.name) || activityName.equals(activityInfo.name)) {
                    return activityInfo;
                }
            }
        } catch (RuntimeException ignored) {
            // Fall back to PackageManager's package-level launch intent below.
        }
        return null;
    }

    private static String canonicalActivityName(String packageName, String activityName) {
        if (activityName == null || activityName.isEmpty()) return "";
        if (activityName.charAt(0) == '.') return packageName + activityName;
        return activityName.indexOf('.') < 0 ? packageName + "." + activityName : activityName;
    }

    private static boolean isValidPackageName(String packageName) {
        return packageName != null && packageName.length() <= 200 &&
            packageName.matches("^[a-zA-Z][a-zA-Z0-9_]*(?:\\.[a-zA-Z][a-zA-Z0-9_]*)+$");
    }

    private static void putNodeActionResult(JSObject result, YachiyoAccessibilityService.NodeActionResult action) {
        result.put("success", action.success);
        if (action.ambiguous) result.put("ambiguous", true);
        if (!TextUtils.isEmpty(action.method)) result.put("method", action.method);
        if (!TextUtils.isEmpty(action.reason)) result.put("reason", action.reason);
        if (!TextUtils.isEmpty(action.node)) result.put("node", action.node);
    }

    private static YachiyoAccessibilityService.AccessibilitySelector selectorFromCall(PluginCall call) {
        return selectorFromCall(call, false);
    }

    private static YachiyoAccessibilityService.AccessibilitySelector selectorFromCall(PluginCall call, boolean replacementText) {
        String selectorText = call.getString("selectorText", "");
        if (!replacementText && TextUtils.isEmpty(selectorText)) selectorText = call.getString("text", "");
        return new YachiyoAccessibilityService.AccessibilitySelector(
            call.getString("packageName", ""),
            call.getString("resourceId", ""),
            selectorText,
            call.getString("contentDescription", ""),
            call.getString("role", ""),
            call.getString("ancestorSignature", ""),
            null,
            null,
            null
        );
    }

    private List<LaunchableAppRecord> queryLaunchableApps() {
        PackageManager packageManager = getContext().getPackageManager();
        List<ResolveInfo> activities = queryLauncherActivities(packageManager);
        List<LaunchableAppRecord> records = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (ResolveInfo resolveInfo : activities) {
            ActivityInfo activityInfo = resolveInfo.activityInfo;
            if (activityInfo == null || activityInfo.applicationInfo == null) continue;
            String packageName = activityInfo.packageName;
            String activityName = activityInfo.name;
            String key = packageName + "/" + activityName;
            if (!seen.add(key)) continue;
            ApplicationInfo applicationInfo = activityInfo.applicationInfo;
            CharSequence labelValue;
            try {
                labelValue = resolveInfo.loadLabel(packageManager);
            } catch (RuntimeException ignored) {
                labelValue = null;
            }
            if (TextUtils.isEmpty(labelValue) && applicationInfo != null) {
                try {
                    labelValue = packageManager.getApplicationLabel(applicationInfo);
                } catch (RuntimeException ignored) {
                    labelValue = null;
                }
            }
            String label = TextUtils.isEmpty(labelValue) ? packageName : labelValue.toString();
            Set<String> aliases = new LinkedHashSet<>();
            try {
                addAlias(aliases, packageManager.getApplicationLabel(applicationInfo), label);
            } catch (RuntimeException ignored) {
                // A package can disappear between query and label lookup.
            }
            addLocalizedAliases(aliases, packageName, applicationInfo, activityInfo, label);
            long versionCode;
            try {
                versionCode = Build.VERSION.SDK_INT >= 28
                    ? packageManager.getPackageInfo(packageName, 0).getLongVersionCode()
                    : packageManager.getPackageInfo(packageName, 0).versionCode;
            } catch (PackageManager.NameNotFoundException ignored) {
                versionCode = 0L;
            }
            records.add(new LaunchableAppRecord(packageName, activityName, label, versionCode, aliases));
        }
        Collections.sort(records, Comparator.comparing(record -> record.label.toLowerCase(Locale.ROOT)));
        return records;
    }

    private static List<ResolveInfo> queryLauncherActivities(PackageManager packageManager) {
        Intent launcherIntent = new Intent(Intent.ACTION_MAIN);
        launcherIntent.addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> activities = packageManager.queryIntentActivities(launcherIntent, PackageManager.MATCH_ALL);
        return activities == null ? Collections.emptyList() : activities;
    }

    private static int appMatchScore(LaunchableAppRecord record, String expected) {
        String packageName = normalizeAppQuery(record.packageName);
        String label = normalizeAppQuery(record.label);
        if (packageName.equals(expected)) return 120;
        if (label.equals(expected)) return 110;
        if (packageName.startsWith(expected)) return 90;
        if (label.startsWith(expected)) return 80;
        if (packageName.contains(expected)) return 60;
        if (label.contains(expected)) return 50;
        for (String alias : record.aliases) {
            String normalizedAlias = normalizeAppQuery(alias);
            if (normalizedAlias.equals(expected)) return 105;
            if (normalizedAlias.startsWith(expected)) return 78;
            if (normalizedAlias.contains(expected)) return 48;
        }
        return 0;
    }

    private void addLocalizedAliases(
        Set<String> aliases,
        String packageName,
        ApplicationInfo applicationInfo,
        ActivityInfo activityInfo,
        String primaryLabel
    ) {
        for (Locale locale : APP_LABEL_LOCALES) {
            addAlias(
                aliases,
                localizedLabel(packageName, activityInfo.labelRes, activityInfo.nonLocalizedLabel, locale),
                primaryLabel
            );
            addAlias(
                aliases,
                localizedLabel(packageName, applicationInfo.labelRes, applicationInfo.nonLocalizedLabel, locale),
                primaryLabel
            );
        }
    }

    private String localizedLabel(
        String packageName,
        int labelRes,
        CharSequence nonLocalizedLabel,
        Locale locale
    ) {
        if (nonLocalizedLabel != null && labelRes == 0) return nonLocalizedLabel.toString();
        if (labelRes == 0) return "";
        try {
            Context packageContext = getContext().createPackageContext(packageName, Context.CONTEXT_IGNORE_SECURITY);
            Configuration configuration = new Configuration(packageContext.getResources().getConfiguration());
            configuration.setLocale(locale);
            Context localizedContext = packageContext.createConfigurationContext(configuration);
            CharSequence value = localizedContext.getResources().getText(labelRes);
            return value == null ? "" : value.toString();
        } catch (PackageManager.NameNotFoundException | RuntimeException ignored) {
            return "";
        }
    }

    private static void addAlias(Set<String> aliases, CharSequence candidate, String primaryLabel) {
        if (candidate == null) return;
        String value = candidate.toString().trim();
        if (value.isEmpty() || normalizeAppQuery(value).equals(normalizeAppQuery(primaryLabel))) return;
        if (value.length() <= 256) aliases.add(value);
    }

    private static String normalizeAppQuery(String value) {
        if (value == null) return "";
        return value.trim().replaceAll("[\\s\\p{Punct}]+", "").toLowerCase(Locale.ROOT);
    }

    private static final class LaunchableAppRecord {
        final String packageName;
        final String activityName;
        final String label;
        final long versionCode;
        final Set<String> aliases;

        LaunchableAppRecord(String packageName, String activityName, String label, long versionCode, Set<String> aliases) {
            this.packageName = packageName;
            this.activityName = activityName;
            this.label = label;
            this.versionCode = versionCode;
            this.aliases = aliases == null ? Collections.emptySet() : new LinkedHashSet<>(aliases);
        }

        JSONObject toJson(long observedAt) {
            JSONObject result = new JSONObject();
            try {
                result.put("packageName", packageName);
                result.put("activityName", activityName);
                result.put("launchActivity", activityName);
                result.put("label", label.length() > 256 ? label.substring(0, 256) : label);
                JSONArray aliasArray = new JSONArray();
                int aliasCount = 0;
                for (String alias : aliases) {
                    if (aliasCount++ >= 20) break;
                    aliasArray.put(alias);
                }
                result.put("aliases", aliasArray);
                result.put("versionCode", versionCode);
                result.put("updatedAt", observedAt);
            } catch (JSONException ignored) {}
            return result;
        }
    }

    private static final class ScoredLaunchableApp {
        final LaunchableAppRecord record;
        final int score;

        ScoredLaunchableApp(LaunchableAppRecord record, int score) {
            this.record = record;
            this.score = score;
        }
    }

    @PluginMethod
    public void showOperationOverlay(PluginCall call) {
        if (!Settings.canDrawOverlays(getContext())) {
            call.reject("overlay_permission_required");
            return;
        }
        getActivity().runOnUiThread(() -> {
            hideOverlayInternal();
            showOverlayInternal(call.getString("text", ""));
            call.resolve();
        });
    }

    @PluginMethod
    public void updateOperationOverlay(PluginCall call) {
        String text = call.getString("text", "");
        getActivity().runOnUiThread(() -> {
            if (streamText != null) {
                streamText.setText(limitText(text));
                streamText.setVisibility(text.trim().isEmpty() ? View.GONE : View.VISIBLE);
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void hideOperationOverlay(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            hideOverlayInternal();
            call.resolve();
        });
    }

    @PluginMethod
    public void requestOperationApproval(PluginCall call) {
        if (!Settings.canDrawOverlays(getContext())) {
            call.reject("overlay_permission_required");
            return;
        }
        getActivity().runOnUiThread(() -> {
            if (pendingApprovalCall != null) {
                call.reject("approval_already_pending");
                return;
            }
            pendingApprovalCall = call;
            showApprovalInternal(
                call.getString("title", "Agent operation"),
                call.getString("detail", ""),
                call.getBoolean("dangerous", false)
            );
        });
    }

    @PluginMethod
    public void cancelOperationApproval(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            finishApprovalInternal("deny");
            call.resolve();
        });
    }

    @PluginMethod
    public void bringAppToForeground(PluginCall call) {
        Intent launch = getContext().getPackageManager().getLaunchIntentForPackage(getContext().getPackageName());
        if (launch == null) {
            call.reject("launch_intent_unavailable");
            return;
        }
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        getContext().startActivity(launch);
        call.resolve();
    }

    private JSObject executeShizuku(String command, int timeoutMs) throws Exception {
        if (!hasShizukuPermission()) throw new SecurityException("shizuku_permission_required");
        IShizukuService service = IShizukuService.Stub.asInterface(Shizuku.getBinder());
        Object process = service.newProcess(new String[] { "sh", "-c", command }, null, null);
        Class<?> processClass = process.getClass();
        ParcelFileDescriptor stdoutDescriptor = (ParcelFileDescriptor) processClass.getMethod("getInputStream").invoke(process);
        ParcelFileDescriptor stderrDescriptor = (ParcelFileDescriptor) processClass.getMethod("getErrorStream").invoke(process);
        Future<String> stdout = collectDescriptor(stdoutDescriptor);
        Future<String> stderr = collectDescriptor(stderrDescriptor);
        Callable<Integer> waiter = () -> (Integer) processClass.getMethod("waitFor").invoke(process);
        Future<Integer> exit = executor.submit(waiter);
        boolean timedOut = false;
        int exitCode;
        try {
            exitCode = exit.get(timeoutMs, TimeUnit.MILLISECONDS);
        } catch (TimeoutException timeout) {
            timedOut = true;
            processClass.getMethod("destroy").invoke(process);
            exitCode = 124;
        }
        JSObject result = new JSObject();
        result.put("stdout", stdout.get(2, TimeUnit.SECONDS));
        result.put("stderr", stderr.get(2, TimeUnit.SECONDS));
        result.put("exitCode", exitCode);
        result.put("timedOut", timedOut);
        return result;
    }

    private Future<String> collectDescriptor(ParcelFileDescriptor descriptor) {
        return executor.submit(() -> {
            if (descriptor == null) return "";
            try (InputStream input = new FileInputStream(descriptor.getFileDescriptor()); descriptor) {
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                byte[] buffer = new byte[8_192];
                int read;
                while ((read = input.read(buffer)) != -1 && output.size() < MAX_OUTPUT_BYTES) {
                    output.write(buffer, 0, Math.min(read, MAX_OUTPUT_BYTES - output.size()));
                }
                return output.toString(StandardCharsets.UTF_8.name());
            }
        });
    }

    private boolean isAccessibilityEnabled() {
        if (YachiyoAccessibilityService.getInstance() != null) return true;
        String enabled = Settings.Secure.getString(getContext().getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        return enabled != null && enabled.contains(getContext().getPackageName() + "/" + YachiyoAccessibilityService.class.getName());
    }

    private boolean isPackageInstalled(String packageName) {
        try {
            getContext().getPackageManager().getPackageInfo(packageName, 0);
            return true;
        } catch (PackageManager.NameNotFoundException ignored) {
            return false;
        }
    }

    private boolean isShizukuRunning() {
        try {
            return Shizuku.pingBinder();
        } catch (Throwable ignored) {
            return false;
        }
    }

    private boolean hasShizukuPermission() {
        try {
            return isShizukuRunning() && Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED;
        } catch (Throwable ignored) {
            return false;
        }
    }

    private Uri packageUri() {
        return Uri.parse("package:" + getContext().getPackageName());
    }

    private void showOverlayInternal(String initialText) {
        windowManager = (WindowManager) getContext().getSystemService(Context.WINDOW_SERVICE);
        edgeGlowView = new EdgeGlowView(getContext());
        WindowManager.LayoutParams edgeParams = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE |
            WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE |
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN |
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        );
        windowManager.addView(edgeGlowView, edgeParams);

        capsuleRoot = new LinearLayout(getContext());
        capsuleRoot.setOrientation(LinearLayout.VERTICAL);
        capsuleRoot.setGravity(Gravity.CENTER_HORIZONTAL);
        capsuleRoot.setPadding(dp(8), dp(6), dp(8), dp(6));

        LinearLayout statusCapsule = new LinearLayout(getContext());
        statusCapsule.setGravity(Gravity.CENTER_VERTICAL);
        statusCapsule.setPadding(dp(14), dp(8), dp(8), dp(8));
        statusCapsule.setBackground(capsuleBackground());
        TextView status = new TextView(getContext());
        status.setText("Yachiyo Claw is operating your device");
        status.setTextColor(Color.WHITE);
        status.setTextSize(13);
        statusCapsule.addView(status);
        Button stop = new Button(getContext());
        stop.setText("Stop");
        stop.setTextColor(Color.rgb(255, 205, 221));
        stop.setTextSize(12);
        stop.setAllCaps(false);
        stop.setBackgroundColor(Color.TRANSPARENT);
        stop.setMinWidth(0);
        stop.setMinimumWidth(0);
        stop.setPadding(dp(10), 0, dp(6), 0);
        stop.setOnClickListener(view -> {
            finishApprovalInternal("deny");
            notifyListeners("overlayStopRequested", new JSObject());
            hideOverlayInternal();
        });
        statusCapsule.addView(stop);
        capsuleRoot.addView(statusCapsule);

        streamText = new TextView(getContext());
        streamText.setText(limitText(initialText));
        streamText.setTextColor(Color.WHITE);
        streamText.setTextSize(12);
        streamText.setMaxLines(3);
        streamText.setPadding(dp(14), dp(9), dp(14), dp(9));
        streamText.setBackground(capsuleBackground());
        LinearLayout.LayoutParams streamParams = new LinearLayout.LayoutParams(dp(320), LinearLayout.LayoutParams.WRAP_CONTENT);
        streamParams.topMargin = dp(7);
        capsuleRoot.addView(streamText, streamParams);
        streamText.setVisibility(initialText.trim().isEmpty() ? View.GONE : View.VISIBLE);

        WindowManager.LayoutParams capsuleParams = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE |
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL |
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        );
        capsuleParams.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        capsuleParams.y = dp(28);
        windowManager.addView(capsuleRoot, capsuleParams);
        capsuleRoot.setAlpha(0f);
        capsuleRoot.setScaleX(0.82f);
        capsuleRoot.setScaleY(0.82f);
        capsuleRoot.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(280).setInterpolator(new DecelerateInterpolator()).start();
    }

    private void showApprovalInternal(String title, String detail, boolean dangerous) {
        windowManager = (WindowManager) getContext().getSystemService(Context.WINDOW_SERVICE);
        approvalRoot = new LinearLayout(getContext());
        approvalRoot.setOrientation(LinearLayout.VERTICAL);
        approvalRoot.setPadding(dp(16), dp(13), dp(16), dp(12));
        approvalRoot.setBackground(approvalBackground(dangerous));

        TextView titleView = new TextView(getContext());
        titleView.setText(title);
        titleView.setTextColor(Color.WHITE);
        titleView.setTextSize(15);
        approvalRoot.addView(titleView);

        TextView detailView = new TextView(getContext());
        detailView.setText(limitApprovalText(detail));
        detailView.setTextColor(Color.rgb(235, 225, 230));
        detailView.setTextSize(12);
        detailView.setMaxLines(5);
        LinearLayout.LayoutParams detailParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        detailParams.topMargin = dp(7);
        approvalRoot.addView(detailView, detailParams);

        LinearLayout actions = new LinearLayout(getContext());
        actions.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams actionsParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        actionsParams.topMargin = dp(8);
        approvalRoot.addView(actions, actionsParams);
        actions.addView(approvalButton("Deny", "deny", Color.rgb(245, 205, 215)));
        actions.addView(approvalButton("Allow once", "once", Color.WHITE));
        actions.addView(approvalButton("Allow for conversation", "conversation", Color.rgb(255, 205, 221)));

        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
            Math.min(dp(380), getContext().getResources().getDisplayMetrics().widthPixels - dp(24)),
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        );
        params.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        params.y = dp(106);
        windowManager.addView(approvalRoot, params);
        approvalRoot.setAlpha(0f);
        approvalRoot.setScaleX(0.88f);
        approvalRoot.setScaleY(0.88f);
        approvalRoot.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(220).setInterpolator(new DecelerateInterpolator()).start();
    }

    private Button approvalButton(String text, String decision, int textColor) {
        Button button = new Button(getContext());
        button.setText(text);
        button.setTextColor(textColor);
        button.setTextSize(12);
        button.setAllCaps(false);
        button.setBackgroundColor(Color.TRANSPARENT);
        button.setMinWidth(0);
        button.setMinimumWidth(0);
        button.setPadding(dp(9), 0, dp(9), 0);
        button.setOnClickListener(view -> finishApprovalInternal(decision));
        return button;
    }

    private GradientDrawable approvalBackground(boolean dangerous) {
        GradientDrawable background = capsuleBackground();
        if (dangerous) background.setStroke(dp(2), Color.rgb(255, 127, 157));
        return background;
    }

    private void finishApprovalInternal(String decision) {
        if (windowManager != null && approvalRoot != null) {
            try {
                windowManager.removeView(approvalRoot);
            } catch (IllegalArgumentException ignored) {}
        }
        approvalRoot = null;
        PluginCall call = pendingApprovalCall;
        pendingApprovalCall = null;
        if (call != null) {
            JSObject result = new JSObject();
            result.put("decision", decision);
            call.resolve(result);
        }
    }

    private GradientDrawable capsuleBackground() {
        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.argb(232, 24, 20, 23));
        background.setCornerRadius(dp(24));
        background.setStroke(dp(1), Color.rgb(230, 142, 170));
        return background;
    }

    private void hideOverlayInternal() {
        if (windowManager != null) {
            if (edgeGlowView != null) {
                try {
                    windowManager.removeView(edgeGlowView);
                } catch (IllegalArgumentException ignored) {}
            }
            if (capsuleRoot != null) {
                try {
                    windowManager.removeView(capsuleRoot);
                } catch (IllegalArgumentException ignored) {}
            }
        }
        edgeGlowView = null;
        capsuleRoot = null;
        streamText = null;
    }

    private int dp(int value) {
        return Math.round(value * getContext().getResources().getDisplayMetrics().density);
    }

    private static String limitText(String value) {
        String trimmed = value == null ? "" : value.trim();
        return trimmed.length() <= 240 ? trimmed : "..." + trimmed.substring(trimmed.length() - 239);
    }

    private static String limitApprovalText(String value) {
        String trimmed = value == null ? "" : value.trim();
        return trimmed.length() <= 800 ? trimmed : trimmed.substring(0, 799) + "...";
    }

    @Override
    protected void handleOnDestroy() {
        if (packageChangeReceiver != null) {
            try {
                getContext().unregisterReceiver(packageChangeReceiver);
            } catch (IllegalArgumentException ignored) {}
            packageChangeReceiver = null;
        }
        Runnable removeWindows = () -> {
            finishApprovalInternal("deny");
            hideOverlayInternal();
        };
        if (Looper.myLooper() == Looper.getMainLooper()) {
            removeWindows.run();
        } else {
            new Handler(Looper.getMainLooper()).post(removeWindows);
        }
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    private static final class EdgeGlowView extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);

        EdgeGlowView(Context context) {
            super(context);
            setLayerType(View.LAYER_TYPE_SOFTWARE, null);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(8f * getResources().getDisplayMetrics().density);
            paint.setColor(Color.rgb(230, 142, 170));
            paint.setShadowLayer(24f * getResources().getDisplayMetrics().density, 0, 0, Color.rgb(230, 142, 170));
        }

        @Override
        protected void onDraw(Canvas canvas) {
            float inset = paint.getStrokeWidth() / 2f;
            canvas.drawRoundRect(new RectF(inset, inset, getWidth() - inset, getHeight() - inset), 22f, 22f, paint);
        }
    }
}
