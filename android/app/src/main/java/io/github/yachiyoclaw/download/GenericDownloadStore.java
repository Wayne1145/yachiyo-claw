package io.github.yachiyoclaw.download;

import android.content.Context;
import org.json.JSONObject;

/** Durable metadata for generic downloads whose workers must survive a WebView or app-process restart. */
final class GenericDownloadStore {
    private static final String PREFS = "yachiyo-generic-downloads";
    private static final String KEY = "requests";

    private GenericDownloadStore() {}

    static synchronized void save(Context context, JSONObject request) throws Exception {
        JSONObject root = root(context);
        root.put(request.getString("id"), request);
        write(context, root);
    }

    static synchronized JSONObject get(Context context, String id) {
        try { return root(context).optJSONObject(id); }
        catch (Exception ignored) { return null; }
    }

    static synchronized JSONObject snapshot(Context context) {
        try { return root(context); }
        catch (Exception ignored) { return new JSONObject(); }
    }

    static boolean sameRequest(JSONObject left, JSONObject right) {
        if (left == null || right == null) return false;
        return left.optString("id").equals(right.optString("id"))
            && left.optString("kind").equals(right.optString("kind"))
            && left.optString("url").equals(right.optString("url"))
            && left.optLong("expectedSize", -1) == right.optLong("expectedSize", -2)
            && left.optString("expectedSha256", "").equals(right.optString("expectedSha256", ""));
    }

    static synchronized void remove(Context context, String id) {
        try {
            JSONObject root = root(context);
            root.remove(id);
            write(context, root);
        } catch (Exception ignored) {}
    }

    private static JSONObject root(Context context) throws Exception {
        return new JSONObject(context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "{}"));
    }

    private static void write(Context context, JSONObject root) {
        // The WorkManager request may outlive this process, so its metadata must be on disk before
        // enqueue returns. An asynchronous apply() can lose the URL/size if Android kills us here.
        boolean committed = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY, root.toString()).commit();
        if (!committed) throw new IllegalStateException("download_request_persist_failed");
    }
}
