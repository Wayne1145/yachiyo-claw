package io.github.yachiyoclaw.memory;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import io.github.yachiyoclaw.security.SecureStorageService;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Small native persistence boundary for the encrypted memory index. The JS
 * service performs content filtering and encryption; this plugin refuses
 * plaintext values so a renderer crash cannot leave memory records unprotected.
 */
@CapacitorPlugin(name = "YachiyoMemory")
public final class YachiyoMemoryPlugin extends Plugin {
    private static final String PREFS = "yachiyo_memory_v1";
    private static final int MAX_VALUE_BYTES = 512 * 1024;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private SharedPreferences preferences;

    @Override
    public void load() {
        super.load();
        preferences = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void read(PluginCall call) {
        String key = safeKey(call.getString("key"));
        if (key == null) {
            call.reject("Memory key is required.", "MEMORY_INVALID_INPUT");
            return;
        }
        executor.execute(() -> {
            String value = preferences.getString(key, null);
            JSObject result = new JSObject();
            result.put("found", value != null);
            if (value != null) result.put("value", value);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void write(PluginCall call) {
        String key = safeKey(call.getString("key"));
        String value = call.getString("value");
        if (key == null || value == null || value.length() > MAX_VALUE_BYTES || !SecureStorageService.isEnvelope(value)) {
            call.reject("Encrypted memory value is required.", "MEMORY_INVALID_INPUT");
            return;
        }
        executor.execute(() -> {
            preferences.edit().putString(key, value).apply();
            call.resolve();
        });
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String key = safeKey(call.getString("key"));
        if (key == null) {
            call.reject("Memory key is required.", "MEMORY_INVALID_INPUT");
            return;
        }
        executor.execute(() -> {
            boolean existed = preferences.contains(key);
            preferences.edit().remove(key).apply();
            JSObject result = new JSObject();
            result.put("removed", existed);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void clear(PluginCall call) {
        executor.execute(() -> {
            preferences.edit().clear().apply();
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    private static String safeKey(String value) {
        if (value == null) return null;
        String key = value.trim();
        if (!key.matches("memory:[A-Za-z0-9._:-]{1,128}")) return null;
        return key;
    }
}


