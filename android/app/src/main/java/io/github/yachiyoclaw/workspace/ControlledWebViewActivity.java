package io.github.yachiyoclaw.workspace;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;
import android.view.ViewGroup;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Button;
import android.widget.ProgressBar;
import android.webkit.WebChromeClient;
import android.webkit.SafeBrowsingResponse;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayOutputStream;
import java.lang.ref.WeakReference;

public final class ControlledWebViewActivity extends Activity {
    public static final String EXTRA_URL = "url";
    public static final String EXTRA_PREVIEW_ONLY = "previewOnly";
    private static WeakReference<ControlledWebViewActivity> current = new WeakReference<>(null);

    private WebView webView;
    private boolean previewOnly;
    private TextView address;
    private ProgressBar progress;

    interface ResultCallback { void complete(String value, String error); }

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        previewOnly = getIntent().getBooleanExtra(EXTRA_PREVIEW_ONLY, false);
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        webView.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) { if (address != null) address.setText(url); }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String next = request.getUrl().toString();
                return !BrowserNavigationPolicy.isAllowed(next, previewOnly);
            }

            @Override public void onSafeBrowsingHit(WebView view, WebResourceRequest request, int threatType, SafeBrowsingResponse response) {
                response.backToSafety(true);
            }
        });
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);
        root.setFitsSystemWindows(true);
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setGravity(android.view.Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(8), dp(6), dp(8), dp(6));
        toolbar.setBackgroundColor(Color.rgb(255, 247, 250));
        addToolbarButton(toolbar, "‹", "Back", () -> { if (webView.canGoBack()) webView.goBack(); });
        addToolbarButton(toolbar, "›", "Forward", () -> { if (webView.canGoForward()) webView.goForward(); });
        address = new TextView(this);
        address.setTextSize(12);
        address.setTextColor(Color.rgb(72, 56, 65));
        address.setSingleLine(true);
        address.setEllipsize(android.text.TextUtils.TruncateAt.MIDDLE);
        address.setPadding(dp(12), dp(10), dp(12), dp(10));
        GradientDrawable pill = new GradientDrawable();
        pill.setColor(Color.WHITE);
        pill.setCornerRadius(dp(22));
        address.setBackground(pill);
        toolbar.addView(address, new LinearLayout.LayoutParams(0, dp(40), 1));
        addToolbarButton(toolbar, "↻", "Reload", () -> webView.reload());
        addToolbarButton(toolbar, "×", getString(android.R.string.cancel), this::finish);
        root.addView(toolbar, new LinearLayout.LayoutParams(-1, dp(56)));
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setProgressTintList(android.content.res.ColorStateList.valueOf(Color.rgb(224, 136, 166)));
        root.addView(progress, new LinearLayout.LayoutParams(-1, dp(2)));
        root.addView(webView, new LinearLayout.LayoutParams(-1, 0, 1));
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int value) {
                progress.setProgress(value);
                progress.setVisibility(value == 100 ? android.view.View.INVISIBLE : android.view.View.VISIBLE);
            }
        });
        getWindow().setStatusBarColor(Color.rgb(255, 247, 250));
        getWindow().setNavigationBarColor(Color.WHITE);
        getWindow().getDecorView().setSystemUiVisibility(android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        setContentView(root);
        current = new WeakReference<>(this);
        String initialUrl = getIntent().getStringExtra(EXTRA_URL);
        if (BrowserNavigationPolicy.isAllowed(initialUrl, previewOnly)) webView.loadUrl(initialUrl);
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private void addToolbarButton(LinearLayout toolbar, String label, String description, Runnable action) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextSize(23);
        button.setTextColor(Color.rgb(100, 66, 83));
        button.setBackgroundColor(Color.TRANSPARENT);
        button.setPadding(0, 0, 0, 0);
        button.setMinWidth(0);
        button.setMinimumWidth(0);
        button.setContentDescription(description);
        button.setOnClickListener(view -> action.run());
        toolbar.addView(button, new LinearLayout.LayoutParams(dp(40), dp(44)));
    }

    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack(); else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        if (current.get() == this) current.clear();
        if (webView != null) {
            webView.stopLoading();
            webView.loadUrl("about:blank");
            webView.destroy();
        }
        super.onDestroy();
    }

    static boolean evaluate(String script, ResultCallback callback) {
        ControlledWebViewActivity activity = current.get();
        if (activity == null || activity.webView == null) return false;
        activity.runOnUiThread(() -> activity.webView.evaluateJavascript(script, value -> callback.complete(value, null)));
        return true;
    }

    static boolean load(String url, ResultCallback callback) {
        ControlledWebViewActivity activity = current.get();
        if (activity == null || activity.webView == null) return false;
        if (!BrowserNavigationPolicy.isAllowed(url, activity.previewOnly)) {
            callback.complete(null, "browser_url_not_allowed");
            return true;
        }
        activity.runOnUiThread(() -> {
            activity.webView.loadUrl(url);
            callback.complete("true", null);
        });
        return true;
    }

    static boolean screenshot(ResultCallback callback) {
        ControlledWebViewActivity activity = current.get();
        if (activity == null || activity.webView == null) return false;
        activity.runOnUiThread(() -> {
            try {
                int width = Math.max(1, Math.min(activity.webView.getWidth(), 1440));
                int height = Math.max(1, Math.min(activity.webView.getHeight(), 2400));
                Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
                Canvas canvas = new Canvas(bitmap);
                float scaleX = width / (float) Math.max(1, activity.webView.getWidth());
                float scaleY = height / (float) Math.max(1, activity.webView.getHeight());
                canvas.scale(scaleX, scaleY);
                activity.webView.draw(canvas);
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                bitmap.compress(Bitmap.CompressFormat.JPEG, 82, output);
                bitmap.recycle();
                callback.complete(Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP), null);
            } catch (RuntimeException error) {
                callback.complete(null, "browser_screenshot_failed");
            }
        });
        return true;
    }

    static boolean history(String action, ResultCallback callback) {
        ControlledWebViewActivity activity = current.get();
        if (activity == null || activity.webView == null) return false;
        activity.runOnUiThread(() -> {
            if ("back".equals(action) && activity.webView.canGoBack()) activity.webView.goBack();
            else if ("forward".equals(action) && activity.webView.canGoForward()) activity.webView.goForward();
            else if ("reload".equals(action)) activity.webView.reload();
            else { callback.complete(null, "browser_history_unavailable"); return; }
            callback.complete("true", null);
        });
        return true;
    }

    static boolean waitFor(String script, long timeoutMs, ResultCallback callback) {
        ControlledWebViewActivity activity = current.get();
        if (activity == null || activity.webView == null) return false;
        long deadline = SystemClock.uptimeMillis() + Math.max(100, Math.min(timeoutMs, 30_000));
        Handler handler = new Handler(Looper.getMainLooper());
        Runnable[] poll = new Runnable[1];
        poll[0] = () -> {
            ControlledWebViewActivity live = current.get();
            if (live != activity || live.webView == null) { callback.complete(null, "browser_unavailable"); return; }
            live.webView.evaluateJavascript(script, value -> {
                if (ControlledBrowserScripts.isReadyResult(value)) callback.complete(value, null);
                else if (SystemClock.uptimeMillis() >= deadline) callback.complete(value, "browser_wait_timeout");
                else handler.postDelayed(poll[0], 200);
            });
        };
        activity.runOnUiThread(poll[0]);
        return true;
    }
}
