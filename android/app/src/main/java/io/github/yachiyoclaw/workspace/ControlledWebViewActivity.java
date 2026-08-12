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
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String next = request.getUrl().toString();
                return !BrowserNavigationPolicy.isAllowed(next, previewOnly);
            }

            @Override public void onSafeBrowsingHit(WebView view, WebResourceRequest request, int threatType, SafeBrowsingResponse response) {
                response.backToSafety(true);
            }
        });
        setContentView(webView, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        current = new WeakReference<>(this);
        String initialUrl = getIntent().getStringExtra(EXTRA_URL);
        if (BrowserNavigationPolicy.isAllowed(initialUrl, previewOnly)) webView.loadUrl(initialUrl);
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
                if (value != null && value.contains("\\\"ready\\\":true")) callback.complete(value, null);
                else if (SystemClock.uptimeMillis() >= deadline) callback.complete(value, "browser_wait_timeout");
                else handler.postDelayed(poll[0], 200);
            });
        };
        activity.runOnUiThread(poll[0]);
        return true;
    }
}
