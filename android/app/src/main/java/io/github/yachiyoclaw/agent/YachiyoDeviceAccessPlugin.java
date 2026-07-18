package io.github.yachiyoclaw.agent;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
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
import android.provider.Settings;
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
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import moe.shizuku.server.IShizukuService;
import rikka.shizuku.Shizuku;

@CapacitorPlugin(name = "YachiyoDeviceAccess")
public class YachiyoDeviceAccessPlugin extends Plugin {

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

    @PluginMethod
    public void accessibilityAction(PluginCall call) {
        YachiyoAccessibilityService service = YachiyoAccessibilityService.getInstance();
        if (service == null) {
            call.reject("accessibility_not_running");
            return;
        }
        String action = call.getString("action", "");
        JSObject result = new JSObject();
        switch (action) {
            case "observe":
                result.put("success", true);
                result.put("output", service.observe());
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
            case "launch":
                Intent launch = getContext().getPackageManager().getLaunchIntentForPackage(call.getString("packageName", ""));
                if (launch != null) {
                    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(launch);
                }
                result.put("success", launch != null);
                break;
            default:
                call.reject("unknown_accessibility_action");
                return;
        }
        call.resolve(result);
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
        status.setText("Yachiyo Claw 正在操作你的设备");
        status.setTextColor(Color.WHITE);
        status.setTextSize(13);
        statusCapsule.addView(status);
        Button stop = new Button(getContext());
        stop.setText("停止");
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
        actions.addView(approvalButton("拒绝", "deny", Color.rgb(245, 205, 215)));
        actions.addView(approvalButton("仅本次", "once", Color.WHITE));
        actions.addView(approvalButton("此对话允许", "conversation", Color.rgb(255, 205, 221)));

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
        return trimmed.length() <= 240 ? trimmed : "…" + trimmed.substring(trimmed.length() - 239);
    }

    private static String limitApprovalText(String value) {
        String trimmed = value == null ? "" : value.trim();
        return trimmed.length() <= 800 ? trimmed : trimmed.substring(0, 799) + "…";
    }

    @Override
    protected void handleOnDestroy() {
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
