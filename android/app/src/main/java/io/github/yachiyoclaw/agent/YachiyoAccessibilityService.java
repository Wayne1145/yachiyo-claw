package io.github.yachiyoclaw.agent;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.graphics.Path;
import android.graphics.Rect;
import android.os.Bundle;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import java.util.Locale;

public class YachiyoAccessibilityService extends AccessibilityService {

    private static volatile YachiyoAccessibilityService instance;

    static YachiyoAccessibilityService getInstance() {
        return instance;
    }

    @Override
    protected void onServiceConnected() {
        instance = this;
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {}

    @Override
    public void onInterrupt() {}

    @Override
    public void onDestroy() {
        if (instance == this) instance = null;
        super.onDestroy();
    }

    boolean tap(float x, float y) {
        Path path = new Path();
        path.moveTo(x, y);
        GestureDescription gesture = new GestureDescription.Builder()
            .addStroke(new GestureDescription.StrokeDescription(path, 0, 80))
            .build();
        return dispatchGesture(gesture, null, null);
    }

    boolean swipe(float startX, float startY, float endX, float endY, long durationMs) {
        Path path = new Path();
        path.moveTo(startX, startY);
        path.lineTo(endX, endY);
        GestureDescription gesture = new GestureDescription.Builder()
            .addStroke(new GestureDescription.StrokeDescription(path, 0, Math.max(80, Math.min(durationMs, 5_000))))
            .build();
        return dispatchGesture(gesture, null, null);
    }

    boolean setText(String text) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;
        AccessibilityNodeInfo focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
        if (focused == null || !focused.isEditable()) focused = findFocusedEditable(root, 0);
        if (focused == null) return false;
        Bundle arguments = new Bundle();
        arguments.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
        return focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments);
    }

    private static AccessibilityNodeInfo findFocusedEditable(AccessibilityNodeInfo node, int depth) {
        if (node == null || depth > 40) return null;
        if (node.isEditable() && (node.isFocused() || node.isAccessibilityFocused())) return node;
        for (int index = 0; index < node.getChildCount(); index++) {
            AccessibilityNodeInfo match = findFocusedEditable(node.getChild(index), depth + 1);
            if (match != null) return match;
        }
        return null;
    }

    boolean globalAction(String action) {
        int globalAction;
        switch (action.toUpperCase(Locale.ROOT)) {
            case "BACK":
                globalAction = GLOBAL_ACTION_BACK;
                break;
            case "HOME":
                globalAction = GLOBAL_ACTION_HOME;
                break;
            case "RECENTS":
                globalAction = GLOBAL_ACTION_RECENTS;
                break;
            case "NOTIFICATIONS":
                globalAction = GLOBAL_ACTION_NOTIFICATIONS;
                break;
            case "QUICK_SETTINGS":
                globalAction = GLOBAL_ACTION_QUICK_SETTINGS;
                break;
            default:
                return false;
        }
        return performGlobalAction(globalAction);
    }

    String observe() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return "<hierarchy />";
        StringBuilder output = new StringBuilder("<hierarchy>");
        appendNode(output, root, 0);
        output.append("</hierarchy>");
        return output.toString();
    }

    private static void appendNode(StringBuilder output, AccessibilityNodeInfo node, int depth) {
        if (node == null || depth > 40 || output.length() > 1_500_000) return;
        Rect bounds = new Rect();
        node.getBoundsInScreen(bounds);
        CharSequence text = node.isPassword() ? "[REDACTED]" : node.getText();
        CharSequence description = node.isPassword() ? "" : node.getContentDescription();
        output.append("<node class=\"").append(escape(node.getClassName())).append("\"")
            .append(" text=\"").append(escape(text)).append("\"")
            .append(" description=\"").append(escape(description)).append("\"")
            .append(" viewId=\"").append(escape(node.getViewIdResourceName())).append("\"")
            .append(" bounds=\"").append(bounds.toShortString()).append("\"")
            .append(" clickable=\"").append(node.isClickable()).append("\"")
            .append(" editable=\"").append(node.isEditable()).append("\">");
        for (int index = 0; index < node.getChildCount(); index++) {
            appendNode(output, node.getChild(index), depth + 1);
        }
        output.append("</node>");
    }

    private static String escape(CharSequence value) {
        if (value == null) return "";
        return value.toString()
            .replace("&", "&amp;")
            .replace("\"", "&quot;")
            .replace("<", "&lt;")
            .replace(">", "&gt;");
    }
}
