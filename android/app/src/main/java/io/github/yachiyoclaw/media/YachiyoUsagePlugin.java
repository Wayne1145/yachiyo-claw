package io.github.yachiyoclaw.media;

import android.content.Context;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONObject;

/** The headless runtime has no JS storage. Keep only token metadata for later UI aggregation. */
@CapacitorPlugin(name = "YachiyoUsage")
public final class YachiyoUsagePlugin extends Plugin {
    private static final String PREFS = "yachiyo_usage_v1";
    private static final long RETENTION = 90L * 86400000L;

    public static synchronized void record(Context context, String id, String provider, String model, JSONObject usage, int tools) {
        if (usage == null) return;
        try {
            long input = Math.max(0, usage.optLong("prompt_tokens", usage.optLong("input_tokens", 0)));
            long output = Math.max(0, usage.optLong("completion_tokens", usage.optLong("output_tokens", 0)));
            if (input + output == 0) return;
            JSONObject inDetails = usage.optJSONObject("prompt_tokens_details");
            if (inDetails == null) inDetails = usage.optJSONObject("input_tokens_details");
            JSONObject outDetails = usage.optJSONObject("completion_tokens_details");
            if (outDetails == null) outDetails = usage.optJSONObject("output_tokens_details");
            long now = System.currentTimeMillis();
            JSONArray previous = new JSONArray(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("entries", "[]"));
            JSONArray next = new JSONArray();
            for (int i = Math.max(0, previous.length() - 9999); i < previous.length(); i++) {
                JSONObject entry = previous.optJSONObject(i);
                if (entry != null && entry.optLong("at") >= now - RETENTION && !id.equals(entry.optString("id"))) next.put(entry);
            }
            next.put(new JSONObject().put("id", id).put("at", now).put("provider", provider).put("model", model).put("mode", "agent")
                .put("input", input).put("output", output).put("total", usage.optLong("total_tokens", input + output))
                .put("cached", inDetails == null ? 0 : Math.min(input, Math.max(0, inDetails.optLong("cached_tokens", 0))))
                .put("cacheReported", inDetails != null && inDetails.has("cached_tokens"))
                .put("reasoning", outDetails == null ? 0 : Math.max(0, outDetails.optLong("reasoning_tokens", 0))).put("toolCalls", tools));
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("entries", next.toString()).apply();
        } catch (Exception ignored) { /* Usage accounting must not interrupt a scheduled task. */ }
    }

    @PluginMethod public void readEntries(PluginCall call) {
        try { call.resolve(new JSObject().put("entries", new JSArray(getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("entries", "[]")))); }
        catch (Exception ignored) { call.resolve(new JSObject().put("entries", new JSArray())); }
    }
}
