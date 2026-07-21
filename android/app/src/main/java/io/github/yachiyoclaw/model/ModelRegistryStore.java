package io.github.yachiyoclaw.model;

import android.content.Context;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

final class ModelRegistryStore {
    private static final Object LOCK = new Object();
    private final File registryDir;
    private final File contentDir;

    ModelRegistryStore(Context context) {
        this(new File(context.getFilesDir(), "models"));
    }

    ModelRegistryStore(File root) {
        this.registryDir = new File(root, "registry");
        this.contentDir = new File(root, "content");
        registryDir.mkdirs();
        contentDir.mkdirs();
    }

    void save(JSONObject job) throws Exception {
        String id = requireId(job.optString("id"));
        synchronized (LOCK) {
            File target = jobFile(id);
            File temporary = new File(registryDir, id + ".json.tmp");
            Files.write(temporary.toPath(), job.toString().getBytes(StandardCharsets.UTF_8));
            Files.move(temporary.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        }
    }

    JSONObject read(String id) throws Exception {
        synchronized (LOCK) {
            File file = jobFile(requireId(id));
            if (!file.isFile()) return null;
            return new JSONObject(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
        }
    }

    JSONArray list() {
        synchronized (LOCK) {
            JSONArray result = new JSONArray();
            File[] files = registryDir.listFiles((dir, name) -> name.endsWith(".json"));
            if (files == null) return result;
            List<File> ordered = new ArrayList<>(List.of(files));
            ordered.sort(Comparator.comparingLong(File::lastModified).reversed());
            for (File file : ordered) {
                try {
                    result.put(new JSONObject(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8)));
                } catch (Exception ignored) {
                    // A corrupt single job cannot hide healthy installed models.
                }
            }
            return result;
        }
    }

    JSONObject update(String id, String status, long downloaded, String errorCode, String modelPath) throws Exception {
        synchronized (LOCK) {
            JSONObject job = read(id);
            if (job == null) throw new IllegalArgumentException("model_job_not_found");
            applyUpdate(job, status, downloaded, errorCode, modelPath);
            save(job);
            return job;
        }
    }

    boolean saveIfWorkerActive(JSONObject job) throws Exception {
        synchronized (LOCK) {
            String id = requireId(job.optString("id"));
            JSONObject persisted = read(id);
            if (persisted == null || !isWorkerActive(persisted.optString("status"))) return false;
            save(job);
            return true;
        }
    }

    boolean updateIfWorkerActive(String id, String status, long downloaded, String errorCode, String modelPath) throws Exception {
        synchronized (LOCK) {
            JSONObject job = read(id);
            if (job == null || !isWorkerActive(job.optString("status"))) return false;
            applyUpdate(job, status, downloaded, errorCode, modelPath);
            save(job);
            return true;
        }
    }

    JSONObject findCompletedModel(String modelId) {
        JSONArray jobs = list();
        for (int index = 0; index < jobs.length(); index++) {
            JSONObject job = jobs.optJSONObject(index);
            if (job != null && modelId.equals(job.optString("modelId")) && "completed".equals(job.optString("status"))) {
                return job;
            }
        }
        return null;
    }

    File modelDirectory(JSONObject job) throws Exception {
        String repository = job.optString("repository");
        String revision = job.optString("revision");
        if (repository.trim().isEmpty() || revision.trim().isEmpty()) throw new IllegalArgumentException("model_identity_invalid");
        File directory = new File(new File(contentDir, sha256(repository).substring(0, 24)), sha256(revision).substring(0, 24));
        if (!directory.mkdirs() && !directory.isDirectory()) throw new IllegalStateException("model_directory_unavailable");
        return directory.getCanonicalFile();
    }

    void deleteModel(String modelId) throws Exception {
        JSONObject job = findCompletedModel(modelId);
        if (job == null) return;
        File directory = modelDirectory(job);
        String root = contentDir.getCanonicalPath() + File.separator;
        if (!directory.getCanonicalPath().startsWith(root)) throw new SecurityException("model_delete_path_rejected");
        try (var paths = Files.walk(directory.toPath())) {
            paths.sorted(Comparator.reverseOrder()).forEach(path -> {
                try { Files.deleteIfExists(path); } catch (Exception ignored) {}
            });
        }
        update(job.optString("id"), "cancelled", 0, null, null);
    }

    private File jobFile(String id) {
        return new File(registryDir, id + ".json");
    }

    static boolean isWorkerActive(String status) {
        return "queued".equals(status) || "downloading".equals(status);
    }

    private static void applyUpdate(JSONObject job, String status, long downloaded, String errorCode, String modelPath) throws Exception {
        job.put("status", status);
        job.put("bytesDownloaded", Math.max(0, downloaded));
        job.put("updatedAt", System.currentTimeMillis());
        if (errorCode == null) job.remove("error");
        else job.put("error", new JSONObject().put("code", errorCode).put("message", errorCode));
        if (modelPath != null) job.put("modelPath", modelPath);
    }

    private static String requireId(String value) {
        if (value == null || !value.matches("[A-Za-z0-9._-]{1,100}")) throw new IllegalArgumentException("model_job_id_invalid");
        return value;
    }

    private static String sha256(String value) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder();
        for (byte item : digest) result.append(String.format("%02x", item));
        return result.toString();
    }
}
