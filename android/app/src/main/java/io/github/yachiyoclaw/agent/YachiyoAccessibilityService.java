package io.github.yachiyoclaw.agent;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.graphics.Path;
import android.graphics.Rect;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;

/**
 * The accessibility backend intentionally keeps observation and actions local to
 * the service. A fresh node tree is resolved for every action so a UI refresh
 * cannot make a previously captured node or coordinate unsafe to reuse.
 */
public class YachiyoAccessibilityService extends AccessibilityService {

    static final int SEMANTIC_MAX_BYTES = 16 * 1024;
    private static final int MAX_DEPTH = 40;
    private static final int MAX_NODES = 512;
    private static final int MAX_VALUE_CHARS = 256;
    private static final int MAX_SELECTOR_CHARS = 500;

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
        AccessibilityNodeInfo focused = null;
        try {
            focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
            if (focused == null || !focused.isEditable()) {
                if (focused != null && focused != root) focused.recycle();
                focused = findFocusedEditable(root, 0);
            }
            if (focused == null) return false;
            Bundle arguments = new Bundle();
            arguments.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, limitInput(text));
            return focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments);
        } finally {
            if (focused != null && focused != root) focused.recycle();
            root.recycle();
        }
    }

    private static AccessibilityNodeInfo findFocusedEditable(AccessibilityNodeInfo node, int depth) {
        if (node == null || depth > MAX_DEPTH) return null;
        if (node.isEditable() && (node.isFocused() || node.isAccessibilityFocused())) return node;
        for (int index = 0; index < node.getChildCount(); index++) {
            AccessibilityNodeInfo child = node.getChild(index);
            if (child == null) continue;
            AccessibilityNodeInfo match = findFocusedEditable(child, depth + 1);
            if (match != null) {
                if (match != child) child.recycle();
                return match;
            }
            child.recycle();
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

    /**
     * Legacy XML observation retained for existing callers. New callers should
     * use observeSemantic(), which is bounded and much smaller for model input.
     */
    String observe() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return "<hierarchy />";
        StringBuilder output = new StringBuilder("<hierarchy>");
        appendNode(output, root, 0);
        output.append("</hierarchy>");
        return output.toString();
    }

    private static void appendNode(StringBuilder output, AccessibilityNodeInfo node, int depth) {
        if (node == null || depth > MAX_DEPTH || output.length() > 1_500_000) return;
        Rect bounds = new Rect();
        node.getBoundsInScreen(bounds);
        CharSequence text = isSensitive(node) ? "[REDACTED]" : node.getText();
        CharSequence description = isSensitive(node) ? "" : node.getContentDescription();
        output.append("<node class=\"").append(escape(node.getClassName())).append("\"")
            .append(" text=\"").append(escape(text)).append("\"")
            .append(" description=\"").append(escape(description)).append("\"")
            .append(" viewId=\"").append(escape(safeResourceId(node))).append("\"")
            .append(" bounds=\"").append(bounds.toShortString()).append("\"")
            .append(" clickable=\"").append(node.isClickable()).append("\"")
            .append(" editable=\"").append(node.isEditable()).append("\">");
        for (int index = 0; index < node.getChildCount(); index++) {
            appendNode(output, node.getChild(index), depth + 1);
        }
        output.append("</node>");
    }

    /**
     * Return a compact, redacted semantic snapshot. The result is always valid
     * JSON and is hard-limited to 16 KiB including UTF-8 multibyte characters.
     */
    String observeSemantic() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return emptySemanticSnapshot();
        try {
            String packageName = safePackageName(root);
            StringBuilder output = new StringBuilder();
            output.append("{\"version\":1,\"packageName\":")
                .append(jsonString(packageName))
                .append(",\"nodes\":[");
            SemanticState state = new SemanticState(output);
            appendSemanticNode(output, root, "", 0, state);
            output.append("],\"nodeCount\":").append(state.visited)
                .append(",\"truncated\":").append(state.truncated)
                .append(",\"screenSignature\":")
                .append(jsonString(sha256(state.signature.length() == 0 ? packageName : state.signature.toString())))
                .append("}");

            String result = output.toString();
            if (utf8Length(result) <= SEMANTIC_MAX_BYTES) return result;
            // This is only reachable when metadata itself is unexpectedly large.
            return emptySemanticSnapshot(packageName, true);
        } finally {
            root.recycle();
        }
    }

    String findNodeJson(AccessibilitySelector selector) {
        NodeFindResult result = findNodeResult(selector);
        return result.found && !result.ambiguous ? result.node : "";
    }

    NodeFindResult findNodeResult(AccessibilitySelector selector) {
        NodeResolution resolution = resolveNode(selector);
        if (!resolution.found()) {
            return NodeFindResult.notFound(resolution.ambiguous);
        }
        try {
            return NodeFindResult.found(
                semanticNodeJson(resolution.match.node, resolution.match.ancestorSignature, -1)
            );
        } finally {
            resolution.recycle();
        }
    }

    NodeActionResult clickNode(AccessibilitySelector selector) {
        NodeResolution resolution = resolveNode(selector);
        if (!resolution.found()) {
            return resolution.ambiguous
                ? NodeActionResult.ambiguous()
                : NodeActionResult.failure("node_not_found");
        }
        NodeMatch match = resolution.match;
        try {
            if (match.node.isVisibleToUser() && match.node.isEnabled() &&
                match.node.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                return NodeActionResult.success("node_click", semanticNodeJson(match.node, match.ancestorSignature, -1));
            }

            AccessibilityNodeInfo parent = match.node.getParent();
            int depth = 0;
            while (parent != null && depth++ < 8) {
                AccessibilityNodeInfo next = null;
                try {
                    if (parent.isVisibleToUser() && parent.isEnabled() &&
                        parent.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                        return NodeActionResult.success("ancestor_click", semanticNodeJson(match.node, match.ancestorSignature, -1));
                    }
                    next = parent.getParent();
                } catch (RuntimeException ignored) {
                    break;
                } finally {
                    parent.recycle();
                }
                parent = next;
            }

            Rect bounds = new Rect();
            match.node.getBoundsInScreen(bounds);
            if (match.node.isVisibleToUser() && match.node.isEnabled() &&
                !bounds.isEmpty() && tap(bounds.centerX(), bounds.centerY())) {
                return NodeActionResult.success("coordinate_fallback", semanticNodeJson(match.node, match.ancestorSignature, -1));
            }
            return NodeActionResult.failure("node_click_failed");
        } finally {
            resolution.recycle();
        }
    }

    NodeActionResult setNodeText(AccessibilitySelector selector, String text) {
        NodeResolution resolution = resolveNode(selector);
        if (!resolution.found()) {
            return resolution.ambiguous
                ? NodeActionResult.ambiguous()
                : NodeActionResult.failure("node_not_found");
        }
        NodeMatch match = resolution.match;
        try {
            if (!match.node.isVisibleToUser() || !match.node.isEnabled() || !match.node.isEditable()) {
                return NodeActionResult.failure("node_not_editable");
            }
            if (!match.node.isFocused()) match.node.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
            Bundle arguments = new Bundle();
            arguments.putCharSequence(
                AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
                limitInput(text)
            );
            boolean success = match.node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments);
            return success
                ? NodeActionResult.success("node_set_text", semanticNodeJson(match.node, match.ancestorSignature, -1))
                : NodeActionResult.failure("node_set_text_failed");
        } finally {
            resolution.recycle();
        }
    }

    NodeActionResult scrollNode(AccessibilitySelector selector, String direction) {
        if (direction == null) return NodeActionResult.failure("invalid_scroll_direction");
        String normalizedDirection = direction.toLowerCase(Locale.ROOT);
        if (!("up".equals(normalizedDirection) || "down".equals(normalizedDirection) ||
            "left".equals(normalizedDirection) || "right".equals(normalizedDirection) ||
            "forward".equals(normalizedDirection) || "backward".equals(normalizedDirection))) {
            return NodeActionResult.failure("invalid_scroll_direction");
        }
        // Android exposes only vertical scroll actions as integer constants on
        // the API levels supported by this app. Horizontal scrolling uses the
        // bounded gesture fallback below.
        int action = scrollAction(normalizedDirection);
        NodeResolution resolution = resolveNode(selector);
        if (!resolution.found()) {
            return resolution.ambiguous
                ? NodeActionResult.ambiguous()
                : NodeActionResult.failure("node_not_found");
        }
        NodeMatch match = resolution.match;
        try {
            if (action != 0 && match.node.isVisibleToUser() && match.node.isEnabled() &&
                match.node.performAction(action)) {
                return NodeActionResult.success("node_scroll", semanticNodeJson(match.node, match.ancestorSignature, -1));
            }

            AccessibilityNodeInfo parent = match.node.getParent();
            int depth = 0;
            while (parent != null && depth++ < 8) {
                AccessibilityNodeInfo next = null;
                try {
                    if (action != 0 && parent.isVisibleToUser() && parent.isEnabled() &&
                        parent.performAction(action)) {
                        return NodeActionResult.success("ancestor_scroll", semanticNodeJson(match.node, match.ancestorSignature, -1));
                    }
                    next = parent.getParent();
                } catch (RuntimeException ignored) {
                    break;
                } finally {
                    parent.recycle();
                }
                parent = next;
            }

            // Some custom views expose bounds but no scroll action. Keep this as
            // an explicit fallback so callers can distinguish it from node IO.
            Rect bounds = new Rect();
            match.node.getBoundsInScreen(bounds);
            if (match.node.isVisibleToUser() && match.node.isEnabled() && !bounds.isEmpty()) {
                float x = bounds.centerX();
                float y = bounds.centerY();
                float distanceX = 0;
                float distanceY = 0;
                switch (normalizedDirection) {
                    case "up":
                    case "forward":
                        distanceY = -Math.max(80, bounds.height() * 0.65f);
                        break;
                    case "down":
                    case "backward":
                        distanceY = Math.max(80, bounds.height() * 0.65f);
                        break;
                    case "left":
                        distanceX = -Math.max(80, bounds.width() * 0.65f);
                        break;
                    case "right":
                        distanceX = Math.max(80, bounds.width() * 0.65f);
                        break;
                    default:
                        return NodeActionResult.failure("invalid_scroll_direction");
                }
                if (swipe(x, y, x + distanceX, y + distanceY, 350)) {
                    return NodeActionResult.success("coordinate_fallback", semanticNodeJson(match.node, match.ancestorSignature, -1));
                }
            }
            return NodeActionResult.failure("node_scroll_failed");
        } finally {
            resolution.recycle();
        }
    }

    private NodeResolution resolveNode(AccessibilitySelector selector) {
        if (selector == null || selector.isEmpty()) return NodeResolution.notFound(false);
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return NodeResolution.notFound(false);
        NodeSearchState state = new NodeSearchState();
        try {
            findNodeRecursive(root, selector, "", 0, state);
        } finally {
            root.recycle();
        }
        if (state.best == null) return NodeResolution.notFound(false);
        if (state.ties > 1) {
            state.best.recycle();
            return NodeResolution.notFound(true);
        }
        return NodeResolution.found(state.best);
    }

    private static void findNodeRecursive(
        AccessibilityNodeInfo node,
        AccessibilitySelector selector,
        String ancestorSignature,
        int depth,
        NodeSearchState state
    ) {
        if (node == null || depth > MAX_DEPTH || state.visited >= MAX_NODES) return;
        state.visited++;
        String nodeSignature = appendAncestorSignature(ancestorSignature, node);
        int score = selector.matchScore(node, nodeSignature);
        if (score > 0) {
            if (score > state.bestScore) {
                if (state.best != null) state.best.recycle();
                state.best = new NodeMatch(AccessibilityNodeInfo.obtain(node), nodeSignature, score);
                state.bestScore = score;
                state.ties = 1;
            } else if (score == state.bestScore) {
                state.ties++;
            }
        }
        int childCount = Math.min(node.getChildCount(), MAX_NODES - state.visited);
        for (int index = 0; index < childCount; index++) {
            AccessibilityNodeInfo child = node.getChild(index);
            if (child == null) continue;
            try {
                findNodeRecursive(child, selector, nodeSignature, depth + 1, state);
            } finally {
                child.recycle();
            }
        }
    }

    private static int scrollAction(String direction) {
        if (direction == null) return 0;
        switch (direction.toLowerCase(Locale.ROOT)) {
            case "down":
            case "forward":
                return AccessibilityNodeInfo.ACTION_SCROLL_FORWARD;
            case "up":
            case "backward":
                return AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD;
            // There are no portable integer ACTION_SCROLL_LEFT/RIGHT
            // constants through the app's min/target API range. Return zero
            // and let scrollNode use the coordinate fallback for these axes.
            case "left":
            case "right":
                return 0;
            default:
                return 0;
        }
    }

    private static String appendAncestorSignature(String ancestor, AccessibilityNodeInfo node) {
        String token = roleFor(node);
        String resourceId = safeResourceId(node);
        if (!TextUtils.isEmpty(resourceId)) token += "#" + resourceId;
        if (TextUtils.isEmpty(ancestor)) return truncateValue(token, 256);
        return truncateValue(ancestor + ">" + token, 256);
    }

    private static String semanticNodeJson(AccessibilityNodeInfo node, String ancestorSignature, int index) {
        Rect bounds = new Rect();
        node.getBoundsInScreen(bounds);
        boolean sensitive = isSensitive(node);
        String text = sensitive ? "[REDACTED]" : safeText(node.getText());
        String description = sensitive ? "" : safeText(node.getContentDescription());
        String nodeId = semanticNodeId(node, ancestorSignature, bounds, index);
        StringBuilder json = new StringBuilder();
        json.append("{\"nodeId\":").append(jsonString(nodeId))
            .append(",\"role\":").append(jsonString(truncateValue(roleFor(node), MAX_VALUE_CHARS)))
            .append(",\"text\":").append(jsonString(truncateValue(text, MAX_VALUE_CHARS)))
            .append(",\"contentDescription\":").append(jsonString(truncateValue(description, MAX_VALUE_CHARS)))
            .append(",\"resourceId\":").append(jsonString(truncateValue(safeResourceId(node), MAX_VALUE_CHARS)))
            .append(",\"packageName\":").append(jsonString(truncateValue(safePackageName(node), MAX_VALUE_CHARS)))
            .append(",\"clickable\":").append(node.isClickable())
            .append(",\"editable\":").append(node.isEditable())
            .append(",\"checked\":").append(node.isChecked())
            .append(",\"selected\":").append(node.isSelected())
            .append(",\"visible\":").append(node.isVisibleToUser())
            .append(",\"bounds\":{\"left\":").append(bounds.left)
            .append(",\"top\":").append(bounds.top)
            .append(",\"right\":").append(bounds.right)
            .append(",\"bottom\":").append(bounds.bottom).append("}")
            .append(",\"className\":").append(jsonString(truncateValue(safeClassName(node), MAX_VALUE_CHARS)))
            .append(",\"ancestorSignature\":").append(jsonString(truncateValue(ancestorSignature, MAX_VALUE_CHARS)))
            .append(",\"sensitive\":").append(sensitive);
        if (index >= 0) json.append(",\"index\":").append(index);
        return json.append("}").toString();
    }

    private static String semanticNodeId(
        AccessibilityNodeInfo node,
        String ancestorSignature,
        Rect bounds,
        int index
    ) {
        String seed = truncateValue(ancestorSignature, MAX_VALUE_CHARS) + "|" +
            safeResourceId(node) + "|" + bounds.left + "," + bounds.top + "," +
            bounds.right + "," + bounds.bottom + "|" + index;
        return "node-" + sha256(seed).substring(0, 24);
    }

    private static void appendSemanticNode(
        StringBuilder output,
        AccessibilityNodeInfo node,
        String ancestorSignature,
        int depth,
        SemanticState state
    ) {
        if (state.truncated) return;
        if (node == null || depth > MAX_DEPTH || state.visited >= MAX_NODES) {
            state.truncated = true;
            return;
        }
        state.visited++;
        String nodeSignature = appendAncestorSignature(ancestorSignature, node);
        if (isMeaningful(node)) {
            String candidate = semanticNodeJson(node, nodeSignature, state.emitted);
            int projected = utf8Length(output.toString()) + utf8Length(candidate) + 320;
            if (projected <= SEMANTIC_MAX_BYTES) {
                if (state.emitted > 0) output.append(',');
                output.append(candidate);
                state.emitted++;
                appendStableSignature(state.signature, node, nodeSignature);
            } else {
                state.truncated = true;
                return;
            }
        }
        int availableChildren = MAX_NODES - state.visited;
        int childCount = Math.min(node.getChildCount(), availableChildren);
        boolean childOverflow = node.getChildCount() > childCount;
        for (int index = 0; index < childCount && !state.truncated; index++) {
            AccessibilityNodeInfo child = node.getChild(index);
            if (child == null) continue;
            appendSemanticNode(output, child, nodeSignature, depth + 1, state);
            child.recycle();
        }
        if (childOverflow) state.truncated = true;
    }

    private static boolean isMeaningful(AccessibilityNodeInfo node) {
        if (node == null) return false;
        if (!node.isVisibleToUser() && !node.isFocused() && !node.isAccessibilityFocused()) return false;
        return !TextUtils.isEmpty(safeText(node.getText())) ||
            !TextUtils.isEmpty(safeText(node.getContentDescription())) ||
            !TextUtils.isEmpty(safeResourceId(node)) ||
            node.isClickable() || node.isEditable() || node.isCheckable() || node.isScrollable();
    }

    /**
     * Build a page fingerprint from stable launcher affordances. Dynamic status
     * text (clock, date, battery) is intentionally excluded so a valid icon
     * placement does not expire on every observation.
     */
    private static void appendStableSignature(
        StringBuilder signature,
        AccessibilityNodeInfo node,
        String ancestorSignature
    ) {
        if (node == null) return;
        String resourceId = safeResourceId(node);
        String text = isSensitive(node) ? "" : safeText(node.getText());
        String description = isSensitive(node) ? "" : safeText(node.getContentDescription());
        if (isDynamicSignatureText(text)) text = "";
        if (isDynamicSignatureText(description)) description = "";
        Rect bounds = new Rect();
        node.getBoundsInScreen(bounds);
        int left = Math.round(bounds.left / 8f) * 8;
        int top = Math.round(bounds.top / 8f) * 8;
        int right = Math.round(bounds.right / 8f) * 8;
        int bottom = Math.round(bounds.bottom / 8f) * 8;
        signature.append(roleFor(node)).append('|')
            .append(truncateValue(resourceId, 128)).append('|')
            .append(truncateValue(text, 128)).append('|')
            .append(truncateValue(description, 128)).append('|')
            .append(truncateValue(ancestorSignature, 128)).append('|')
            .append(left).append(',').append(top).append(',').append(right).append(',').append(bottom).append(';');
    }

    private static boolean isDynamicSignatureText(String value) {
        if (TextUtils.isEmpty(value)) return false;
        String normalized = value.trim();
        return normalized.matches("(?i)\\d{1,2}:\\d{2}(:\\d{2})?") ||
            normalized.matches("\\d{1,4}[-/.]\\d{1,2}[-/.]\\d{1,4}") ||
            normalized.matches("\\d{1,3}%");
    }

    private static boolean isSensitive(AccessibilityNodeInfo node) {
        if (node == null) return false;
        if (node.isPassword()) return true;
        String marker = (safeClassName(node) + " " + safeResourceId(node) + " " +
            truncateValue(safeText(node.getContentDescription()), MAX_VALUE_CHARS) + " " +
            truncateValue(safeText(node.getText()), MAX_VALUE_CHARS))
            .toLowerCase(Locale.ROOT);
        String[] sensitiveWords = new String[] {
            "password", "passwd", "secret", "token", "api_key", "apikey", "authorization", "credential",
            "otp", "one-time", "one time", "verification", "verify code", "pin", "cvv", "cvc", "2fa",
            "security code",
        };
        for (String word : sensitiveWords) {
            if (containsSensitiveWord(marker, word)) return true;
        }
        return marker.contains("验证码") || marker.contains("校验码") ||
            marker.contains("密码") || marker.contains("口令") || marker.contains("密钥") ||
            marker.contains("令牌") || marker.contains("授权") || marker.contains("凭证") ||
            marker.contains("支付密码") || marker.contains("安全码");
    }

    private static boolean containsSensitiveWord(String marker, String word) {
        int fromIndex = 0;
        while (fromIndex < marker.length()) {
            int index = marker.indexOf(word, fromIndex);
            if (index < 0) return false;
            int end = index + word.length();
            boolean leftBoundary = index == 0 || !Character.isLetterOrDigit(marker.charAt(index - 1));
            boolean rightBoundary = end == marker.length() || !Character.isLetterOrDigit(marker.charAt(end));
            if (leftBoundary && rightBoundary) return true;
            fromIndex = index + 1;
        }
        return false;
    }

    private static String safePackageName(AccessibilityNodeInfo node) {
        try {
            return node == null || node.getPackageName() == null ? "" : node.getPackageName().toString();
        } catch (RuntimeException ignored) {
            return "";
        }
    }

    private static String safeClassName(AccessibilityNodeInfo node) {
        try {
            return node == null || node.getClassName() == null ? "" : node.getClassName().toString();
        } catch (RuntimeException ignored) {
            return "";
        }
    }

    private static String safeResourceId(AccessibilityNodeInfo node) {
        try {
            String value = node == null ? null : node.getViewIdResourceName();
            return value == null ? "" : value;
        } catch (RuntimeException ignored) {
            return "";
        }
    }

    private static String safeText(CharSequence value) {
        return value == null ? "" : value.toString();
    }

    private static String limitInput(String value) {
        if (value == null) return "";
        return value.length() <= 16_000 ? value : value.substring(0, 16_000);
    }

    private static String roleFor(AccessibilityNodeInfo node) {
        if (node == null) return "unknown";
        if (node.isEditable()) return "textbox";
        if (node.isCheckable()) {
            String className = safeClassName(node).toLowerCase(Locale.ROOT);
            if (className.contains("switch")) return "switch";
            if (className.contains("radio")) return "radio";
            return "checkbox";
        }
        String className = safeClassName(node).toLowerCase(Locale.ROOT);
        if (className.contains("imagebutton")) return "button";
        if (className.contains("button")) return "button";
        if (className.contains("edittext")) return "textbox";
        if (className.contains("textview")) return "text";
        if (className.contains("recyclerview") || className.contains("listview")) return "list";
        if (className.contains("scrollview") || className.contains("viewpager")) return "scrollview";
        if (className.contains("webview")) return "webview";
        if (className.contains("toolbar")) return "toolbar";
        if (className.contains("dialog")) return "dialog";
        if (className.contains("menu")) return "menu";
        if (className.contains("image")) return "image";
        if (node.isScrollable()) return "scrollview";
        if (node.isClickable()) return "button";
        return "container";
    }

    private static String jsonString(String value) {
        if (value == null) return "\"\"";
        StringBuilder result = new StringBuilder(value.length() + 2).append('"');
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            switch (character) {
                case '\\': result.append("\\\\"); break;
                case '"': result.append("\\\""); break;
                case '\n': result.append("\\n"); break;
                case '\r': result.append("\\r"); break;
                case '\t': result.append("\\t"); break;
                case '\b': result.append("\\b"); break;
                case '\f': result.append("\\f"); break;
                default:
                    if (character < 0x20) {
                        result.append(String.format(Locale.ROOT, "\\u%04x", (int) character));
                    } else {
                        result.append(character);
                    }
            }
        }
        return result.append('"').toString();
    }

    private static String escape(CharSequence value) {
        if (value == null) return "";
        return value.toString()
            .replace("&", "&amp;")
            .replace("\"", "&quot;")
            .replace("<", "&lt;")
            .replace(">", "&gt;");
    }

    private static String truncateValue(String value, int maxChars) {
        if (value == null) return "";
        return value.length() <= maxChars ? value : value.substring(0, maxChars);
    }

    private static int utf8Length(String value) {
        return value.getBytes(StandardCharsets.UTF_8).length;
    }

    private static String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder output = new StringBuilder(digest.length * 2);
            for (byte item : digest) output.append(String.format(Locale.ROOT, "%02x", item & 0xff));
            return output.toString();
        } catch (Exception ignored) {
            String fallback = Integer.toHexString(value.hashCode());
            StringBuilder padded = new StringBuilder(64);
            while (padded.length() < 64) padded.append(fallback);
            return padded.substring(0, 64);
        }
    }

    private static String emptySemanticSnapshot() {
        return emptySemanticSnapshot("", false);
    }

    private static String emptySemanticSnapshot(String packageName, boolean truncated) {
        return "{\"version\":1,\"packageName\":" + jsonString(truncateValue(packageName, MAX_VALUE_CHARS)) +
            ",\"nodes\":[],\"nodeCount\":0,\"truncated\":" + truncated +
            ",\"screenSignature\":\"empty\"}";
    }

    static final class AccessibilitySelector {
        final String packageName;
        final String resourceId;
        final String text;
        final String contentDescription;
        final String role;
        final String ancestorSignature;
        final Boolean clickable;
        final Boolean editable;
        final Boolean checked;

        AccessibilitySelector(
            String packageName,
            String resourceId,
            String text,
            String contentDescription,
            String role,
            String ancestorSignature,
            Boolean clickable,
            Boolean editable,
            Boolean checked
        ) {
            this.packageName = truncateValue(packageName == null ? "" : packageName.trim(), MAX_SELECTOR_CHARS);
            this.resourceId = truncateValue(resourceId == null ? "" : resourceId.trim(), MAX_SELECTOR_CHARS);
            this.text = truncateValue(text == null ? "" : text.trim(), MAX_SELECTOR_CHARS);
            this.contentDescription = truncateValue(contentDescription == null ? "" : contentDescription.trim(), MAX_SELECTOR_CHARS);
            this.role = truncateValue(role == null ? "" : role.trim(), MAX_SELECTOR_CHARS);
            this.ancestorSignature = truncateValue(ancestorSignature == null ? "" : ancestorSignature.trim(), MAX_SELECTOR_CHARS);
            this.clickable = clickable;
            this.editable = editable;
            this.checked = checked;
        }

        boolean isEmpty() {
            return TextUtils.isEmpty(packageName) && TextUtils.isEmpty(resourceId) && TextUtils.isEmpty(text) &&
                TextUtils.isEmpty(contentDescription) && TextUtils.isEmpty(role) && TextUtils.isEmpty(ancestorSignature) &&
                clickable == null && editable == null && checked == null;
        }

        int matchScore(AccessibilityNodeInfo node, String nodeSignature) {
            if (node == null) return -1;
            if (!node.isVisibleToUser() || !node.isEnabled()) return -1;
            if (!TextUtils.isEmpty(packageName) && !same(packageName, safePackageName(node))) return -1;
            if (!TextUtils.isEmpty(resourceId) && !same(resourceId, safeResourceId(node))) return -1;
            if (!TextUtils.isEmpty(role) && !same(role, roleFor(node))) return -1;
            if (clickable != null && clickable.booleanValue() != node.isClickable()) return -1;
            if (editable != null && editable.booleanValue() != node.isEditable()) return -1;
            if (checked != null && checked.booleanValue() != node.isChecked()) return -1;

            int score = 1;
            if (!TextUtils.isEmpty(resourceId)) score += 100;
            if (!TextUtils.isEmpty(role)) score += 25;
            if (!TextUtils.isEmpty(ancestorSignature)) {
                if (!containsNormalized(nodeSignature, ancestorSignature)) return -1;
                score += 20;
            }
            if (!TextUtils.isEmpty(text)) {
                String value = normalize(safeText(isSensitive(node) ? "" : node.getText()));
                String expected = normalize(text);
                if (value.equals(expected)) score += 90;
                else if (value.contains(expected)) score += 55;
                else return -1;
            }
            if (!TextUtils.isEmpty(contentDescription)) {
                String value = normalize(safeText(isSensitive(node) ? "" : node.getContentDescription()));
                String expected = normalize(contentDescription);
                if (value.equals(expected)) score += 80;
                else if (value.contains(expected)) score += 45;
                else return -1;
            }
            return score;
        }

        private static boolean same(String left, String right) {
            return normalize(left).equals(normalize(right));
        }

        private static boolean containsNormalized(String value, String expected) {
            return normalize(value).contains(normalize(expected));
        }

        private static String normalize(String value) {
            if (value == null) return "";
            return value.trim().replaceAll("\\s+", "").toLowerCase(Locale.ROOT);
        }
    }

    static final class NodeActionResult {
        final boolean success;
        final boolean ambiguous;
        final String method;
        final String reason;
        final String node;

        private NodeActionResult(boolean success, boolean ambiguous, String method, String reason, String node) {
            this.success = success;
            this.ambiguous = ambiguous;
            this.method = method;
            this.reason = reason;
            this.node = node;
        }

        static NodeActionResult success(String method, String node) {
            return new NodeActionResult(true, false, method, "", node);
        }

        static NodeActionResult failure(String reason) {
            return new NodeActionResult(false, false, "", reason, "");
        }

        static NodeActionResult ambiguous() {
            return new NodeActionResult(false, true, "", "node_ambiguous", "");
        }
    }

    static final class NodeFindResult {
        final boolean found;
        final boolean ambiguous;
        final String node;

        private NodeFindResult(boolean found, boolean ambiguous, String node) {
            this.found = found;
            this.ambiguous = ambiguous;
            this.node = node;
        }

        static NodeFindResult found(String node) {
            return new NodeFindResult(true, false, node);
        }

        static NodeFindResult notFound(boolean ambiguous) {
            return new NodeFindResult(false, ambiguous, "");
        }
    }

    private static final class NodeResolution {
        final NodeMatch match;
        final boolean ambiguous;

        private NodeResolution(NodeMatch match, boolean ambiguous) {
            this.match = match;
            this.ambiguous = ambiguous;
        }

        static NodeResolution found(NodeMatch match) {
            return new NodeResolution(match, false);
        }

        static NodeResolution notFound(boolean ambiguous) {
            return new NodeResolution(null, ambiguous);
        }

        boolean found() {
            return match != null && !ambiguous;
        }

        void recycle() {
            if (match != null) match.recycle();
        }
    }

    private static final class NodeMatch {
        final AccessibilityNodeInfo node;
        final String ancestorSignature;
        final int score;

        NodeMatch(AccessibilityNodeInfo node, String ancestorSignature, int score) {
            this.node = node;
            this.ancestorSignature = ancestorSignature;
            this.score = score;
        }

        void recycle() {
            try {
                node.recycle();
            } catch (RuntimeException ignored) {}
        }
    }

    private static final class NodeSearchState {
        int visited;
        int bestScore;
        int ties;
        NodeMatch best;
    }

    private static final class SemanticState {
        final StringBuilder output;
        final StringBuilder signature = new StringBuilder();
        int visited;
        int emitted;
        boolean truncated;

        SemanticState(StringBuilder output) {
            this.output = output;
        }
    }
}
