package io.github.yachiyoclaw.model;

import android.content.Context;
import java.io.File;
import java.io.RandomAccessFile;
import java.nio.channels.FileLock;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import org.json.JSONObject;

/** Small cross-process JSON store for acceleration policy and benchmark profiles. */
final class AccelerationProfileStore {
    private static final String FILE_NAME = "local-model-acceleration.json";
    private final File file;
    private final File lockFile;

    AccelerationProfileStore(Context context) {
        File directory = new File(context.getFilesDir(), "models");
        if (!directory.isDirectory()) directory.mkdirs();
        file = new File(directory, FILE_NAME);
        lockFile = new File(directory, FILE_NAME + ".lock");
    }

    JSONObject settings(String modelId) {
        return locked(root -> {
            JSONObject settings = root.optJSONObject("settings");
            JSONObject value = settings == null ? null : settings.optJSONObject(modelId);
            return value == null ? new JSONObject() : new JSONObject(value.toString());
        }, false);
    }

    void saveSettings(String modelId, String mode, String requestedBackend) {
        locked(root -> {
            JSONObject settings = root.optJSONObject("settings");
            if (settings == null) { settings = new JSONObject(); root.put("settings", settings); }
            settings.put(modelId, new JSONObject()
                .put("mode", AccelerationPolicy.normalizeMode(mode))
                .put("requestedBackend", AccelerationPolicy.normalizeBackend(requestedBackend)));
            return null;
        }, true);
    }

    JSONObject profile(String modelId, String cacheKey) {
        return locked(root -> {
            JSONObject profiles = root.optJSONObject("profiles");
            JSONObject profile = profiles == null ? null : profiles.optJSONObject(modelId);
            if (profile == null || !cacheKey.equals(profile.optString("cacheKey"))) return null;
            return new JSONObject(profile.toString());
        }, false);
    }

    void saveProfile(String modelId, JSONObject profile) {
        locked(root -> {
            JSONObject profiles = root.optJSONObject("profiles");
            if (profiles == null) { profiles = new JSONObject(); root.put("profiles", profiles); }
            profiles.put(modelId, new JSONObject(profile.toString()));
            return null;
        }, true);
    }

    void clearProfile(String modelId) {
        locked(root -> {
            JSONObject profiles = root.optJSONObject("profiles");
            if (profiles != null) profiles.remove(modelId);
            return null;
        }, true);
    }

    private interface Operation<T> { T run(JSONObject root) throws Exception; }

    private <T> T locked(Operation<T> operation, boolean write) {
        try (RandomAccessFile lockHandle = new RandomAccessFile(lockFile, "rw");
             FileLock ignored = lockHandle.getChannel().lock()) {
            JSONObject root = readRoot();
            T value = operation.run(root);
            if (write) writeRoot(root);
            return value;
        } catch (Exception error) {
            throw new IllegalStateException("acceleration_profile_store_failed", error);
        }
    }

    private JSONObject readRoot() throws Exception {
        if (!file.isFile() || file.length() == 0) return new JSONObject();
        return new JSONObject(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
    }

    private void writeRoot(JSONObject root) throws Exception {
        File temporary = new File(file.getPath() + ".tmp");
        Files.write(temporary.toPath(), root.toString().getBytes(StandardCharsets.UTF_8));
        try {
            Files.move(temporary.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (java.nio.file.AtomicMoveNotSupportedException ignored) {
            Files.move(temporary.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING);
        }
    }
}
