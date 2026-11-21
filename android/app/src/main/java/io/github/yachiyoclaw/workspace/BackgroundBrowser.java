package io.github.yachiyoclaw.workspace;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;
import android.view.View;
import android.webkit.SafeBrowsingResponse;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayOutputStream;

/** An isolated offscreen DOM browser. Agent operations never launch a preview Activity. */
final class BackgroundBrowser {
    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());
    private WebView view;
    private boolean loading;
    private boolean closed;

    BackgroundBrowser(Context context) { this.context = context.getApplicationContext(); }

    @SuppressLint("SetJavaScriptEnabled")
    private WebView ensureView() {
        if (closed) throw new IllegalStateException("browser_closed");
        if (view != null) return view;
        view = new WebView(context);
        view.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        // The layout is independent of the user's screen and never overlays application controls.
        view.measure(View.MeasureSpec.makeMeasureSpec(1280, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(900, View.MeasureSpec.EXACTLY));
        view.layout(0, 0, 1280, 900);
        view.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView web, WebResourceRequest request) {
                return !BrowserNavigationPolicy.isAllowed(request.getUrl().toString(), false);
            }
            @Override public void onPageStarted(WebView web, String url, Bitmap icon) { loading = true; }
            @Override public void onPageFinished(WebView web, String url) { loading = false; }
            @Override public void onSafeBrowsingHit(WebView web, WebResourceRequest request, int type, SafeBrowsingResponse response) { response.backToSafety(true); }
        });
        return view;
    }

    private void ready(Runnable action, ControlledWebViewActivity.ResultCallback callback, long deadline) {
        if (closed || view == null) { callback.complete(null, "browser_unavailable"); return; }
        if (loading && SystemClock.uptimeMillis() < deadline) { main.postDelayed(() -> ready(action, callback, deadline), 100); return; }
        if (loading) { callback.complete(null, "browser_navigation_timeout"); return; }
        try { action.run(); } catch (RuntimeException error) { callback.complete(null, "browser_operation_failed"); }
    }

    boolean load(String url, ControlledWebViewActivity.ResultCallback callback) {
        if (!BrowserNavigationPolicy.isAllowed(url, false)) { callback.complete(null, "browser_url_not_allowed"); return true; }
        main.post(() -> {
            try {
                ensureView().loadUrl(url);
                loading = true;
                main.postDelayed(() -> ready(() -> callback.complete("true", null), callback, SystemClock.uptimeMillis() + 15000), 100);
            } catch (RuntimeException error) { callback.complete(null, "browser_unavailable"); }
        });
        return true;
    }

    boolean evaluate(String script, ControlledWebViewActivity.ResultCallback callback) {
        main.post(() -> ready(() -> view.evaluateJavascript(script, result -> callback.complete(result, null)), callback, SystemClock.uptimeMillis() + 15000));
        return true;
    }

    boolean waitFor(String script, long timeout, ControlledWebViewActivity.ResultCallback callback) {
        long deadline = SystemClock.uptimeMillis() + Math.max(100, Math.min(timeout, 30000));
        Runnable[] poll = new Runnable[1];
        poll[0] = () -> {
            if (view == null || closed) { callback.complete(null, "browser_unavailable"); return; }
            view.evaluateJavascript(script, result -> {
                if (ControlledBrowserScripts.isReadyResult(result)) callback.complete(result, null);
                else if (SystemClock.uptimeMillis() >= deadline) callback.complete(result, "browser_wait_timeout");
                else main.postDelayed(poll[0], 200);
            });
        };
        main.post(poll[0]);
        return true;
    }

    boolean history(String action, ControlledWebViewActivity.ResultCallback callback) {
        main.post(() -> ready(() -> {
            if ("back".equals(action) && view.canGoBack()) view.goBack();
            else if ("forward".equals(action) && view.canGoForward()) view.goForward();
            else if ("reload".equals(action)) view.reload();
            else { callback.complete(null, "browser_history_unavailable"); return; }
            main.postDelayed(() -> ready(() -> callback.complete("true", null), callback, SystemClock.uptimeMillis() + 15000), 100);
        }, callback, SystemClock.uptimeMillis() + 15000));
        return true;
    }

    boolean screenshot(ControlledWebViewActivity.ResultCallback callback) {
        main.post(() -> ready(() -> {
            Bitmap bitmap = Bitmap.createBitmap(1280, 900, Bitmap.Config.ARGB_8888);
            try {
                view.draw(new Canvas(bitmap));
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                bitmap.compress(Bitmap.CompressFormat.JPEG, 85, output);
                callback.complete(Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP), null);
            } finally { bitmap.recycle(); }
        }, callback, SystemClock.uptimeMillis() + 15000));
        return true;
    }

    void close() {
        main.post(() -> {
            closed = true;
            if (view != null) { view.stopLoading(); view.destroy(); view = null; }
        });
    }
}
