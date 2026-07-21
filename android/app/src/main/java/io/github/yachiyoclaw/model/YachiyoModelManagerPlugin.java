package io.github.yachiyoclaw.model;

import android.app.ActivityManager;
import android.os.Build;
import android.os.StatFs;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import androidx.work.Constraints;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Data;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "YachiyoModelManager")
public final class YachiyoModelManagerPlugin extends Plugin {
    private final ExecutorService inferenceExecutor = Executors.newSingleThreadExecutor();
    private ModelRegistryStore store;

    @Override
    public void load() {
        store = new ModelRegistryStore(getContext());
    }

    @PluginMethod
    public void capabilities(PluginCall call) {
        JSObject result = new JSObject();
        result.put("schemaVersion", 1);
        result.put("runtimes", new JSArray().put("litert-lm").put("mediapipe-text"));
        result.put("formats", new JSArray().put("litertlm").put("tflite"));
        result.put("maxConcurrentFiles", 1);
        result.put("maxConcurrentSegments", 1);
        result.put("appPrivateStorage", true);
        result.put("workManager", true);
        result.put("localInference", true);
        call.resolve(result);
    }

    @PluginMethod
    public void deviceProfile(PluginCall call) {
        ActivityManager manager = getContext().getSystemService(ActivityManager.class);
        ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
        manager.getMemoryInfo(memory);
        StatFs storage = new StatFs(getContext().getFilesDir().getAbsolutePath());
        JSArray supportedAbis = new JSArray();
        for (String abi : Build.SUPPORTED_ABIS) supportedAbis.put(abi);
        JSObject result = new JSObject();
        result.put("androidApi", Build.VERSION.SDK_INT);
        result.put("supportedAbis", supportedAbis);
        result.put("availableRamBytes", memory.availMem);
        result.put("ramBytes", memory.totalMem);
        result.put("availableStorageBytes", storage.getAvailableBytes());
        result.put("storageBytes", storage.getTotalBytes());
        result.put("supportedRuntimes", new JSArray().put("litert-lm").put("mediapipe-text"));
        result.put("supportedFormats", new JSArray().put("litertlm").put("tflite"));
        result.put("soc", Build.VERSION.SDK_INT >= 31 ? Build.SOC_MANUFACTURER + " " + Build.SOC_MODEL : Build.HARDWARE);
        result.put("cpu", Build.HARDWARE);
        call.resolve(result);
    }

    @PluginMethod
    public void list(PluginCall call) {
        JSObject result = new JSObject();
        result.put("schemaVersion", 1);
        result.put("jobs", store.list());
        call.resolve(result);
    }

    @PluginMethod
    public void enqueue(PluginCall call) {
        try {
            JSObject input = call.getObject("job");
            if (input == null) throw new IllegalArgumentException("model_job_required");
            JSONObject job = validateAndNormalize(new JSONObject(input.toString()));
            store.save(job);
            enqueueWork(job.optString("id"));
            call.resolve(new JSObject().put("accepted", true).put("jobId", job.optString("id")));
        } catch (Exception error) {
            call.reject(safeError(error), error);
        }
    }

    @PluginMethod
    public void pause(PluginCall call) {
        transition(call, "paused", true);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        transition(call, "cancelled", true);
    }

    @PluginMethod
    public void resume(PluginCall call) {
        try {
            String jobId = requireJobId(call.getString("jobId"));
            JSONObject job = store.read(jobId);
            if (job == null) throw new IllegalArgumentException("model_job_not_found");
            store.update(jobId, "queued", job.optLong("bytesDownloaded", 0), null, null);
            enqueueWork(jobId);
            call.resolve(new JSObject().put("accepted", true).put("jobId", jobId));
        } catch (Exception error) {
            call.reject(safeError(error), error);
        }
    }

    @PluginMethod
    public void reconcile(PluginCall call) {
        int recovered = 0;
        JSONArray jobs = store.list();
        for (int index = 0; index < jobs.length(); index++) {
            JSONObject job = jobs.optJSONObject(index);
            if (job == null) continue;
            String status = job.optString("status");
            if ("downloading".equals(status) || "queued".equals(status)) {
                enqueueWork(job.optString("id"));
                recovered++;
            }
        }
        call.resolve(new JSObject().put("schemaVersion", 1).put("recovered", recovered));
    }

    @PluginMethod
    public void healthCheck(PluginCall call) {
        String modelId = call.getString("modelId", "");
        JSONObject job = store.findCompletedModel(modelId);
        JSObject result = new JSObject();
        if (job == null) {
            result.put("status", "unsupported").put("reason", "local_model_not_downloaded");
        } else {
            File model = new File(job.optString("modelPath"));
            result.put("status", model.isFile() ? "supported" : "unsupported");
            if (!model.isFile()) result.put("reason", "local_model_file_missing");
        }
        call.resolve(result);
    }

    @PluginMethod
    public void infer(PluginCall call) {
        String modelId = call.getString("modelId", "");
        JSArray messages = call.getArray("messages", new JSArray());
        int maxTokens = call.getInt("maxTokens", 2048);
        inferenceExecutor.execute(() -> {
            try {
                JSONObject job = store.findCompletedModel(modelId);
                if (job == null) throw new IllegalArgumentException("local_model_not_downloaded");
                if (!job.getString("modelPath").toLowerCase().endsWith(".litertlm")) throw new IllegalArgumentException("local_model_not_chat_model");
                String text = LiteRtLmRunner.infer(job.getString("modelPath"), new JSONArray(messages.toString()), maxTokens);
                JSArray events = new JSArray();
                events.put(new JSObject().put("type", "text").put("text", text));
                call.resolve(new JSObject().put("events", events));
            } catch (Exception error) {
                call.reject(safeError(error), error);
            }
        });
    }

    @PluginMethod
    public void embed(PluginCall call) {
        String modelId = call.getString("modelId", "");
        JSArray texts = call.getArray("texts", new JSArray());
        inferenceExecutor.execute(() -> {
            try {
                if (texts.length() == 0 || texts.length() > 32) throw new IllegalArgumentException("embedding_batch_invalid");
                int totalCharacters = 0;
                for (int index = 0; index < texts.length(); index++) {
                    String text = texts.getString(index);
                    if (text == null || text.length() > 8192) throw new IllegalArgumentException("embedding_text_invalid");
                    totalCharacters = Math.addExact(totalCharacters, text.length());
                }
                if (totalCharacters > 65536) throw new IllegalArgumentException("embedding_batch_too_large");
                JSONObject job = store.findCompletedModel(modelId);
                if (job == null) throw new IllegalArgumentException("local_embedding_model_not_downloaded");
                String modelPath = job.getString("modelPath");
                if (!modelPath.toLowerCase().endsWith(".tflite")) throw new IllegalArgumentException("local_model_not_embedding_model");
                JSONArray vectors = MediaPipeTextEmbeddingRunner.embed(getContext(), modelPath, new JSONArray(texts.toString()));
                call.resolve(new JSObject().put("modelId", modelId).put("embeddings", vectors));
            } catch (Exception error) {
                call.reject(safeError(error), error);
            }
        });
    }

    @PluginMethod
    public void unload(PluginCall call) {
        inferenceExecutor.execute(() -> {
            LiteRtLmRunner.unload();
            MediaPipeTextEmbeddingRunner.unload();
            call.resolve();
        });
    }

    @PluginMethod
    public void deleteModel(PluginCall call) {
        try {
            LiteRtLmRunner.unload();
            MediaPipeTextEmbeddingRunner.unload();
            store.deleteModel(call.getString("modelId", ""));
            call.resolve();
        } catch (Exception error) {
            call.reject(safeError(error), error);
        }
    }

    private void transition(PluginCall call, String status, boolean cancelWork) {
        try {
            String jobId = requireJobId(call.getString("jobId"));
            JSONObject job = store.read(jobId);
            if (job == null) throw new IllegalArgumentException("model_job_not_found");
            if (cancelWork) WorkManager.getInstance(getContext()).cancelUniqueWork(workName(jobId));
            store.update(jobId, status, job.optLong("bytesDownloaded", 0), null, null);
            call.resolve(new JSObject().put("accepted", true).put("jobId", jobId));
        } catch (Exception error) {
            call.reject(safeError(error), error);
        }
    }

    private JSONObject validateAndNormalize(JSONObject job) throws Exception {
        String id = requireJobId(job.optString("id"));
        String modelId = job.optString("modelId");
        String repository = job.optString("repository");
        String revision = job.optString("revision");
        if (modelId.trim().isEmpty() || repository.trim().isEmpty() || revision.trim().isEmpty()) throw new IllegalArgumentException("model_identity_invalid");
        JSONArray artifacts = job.optJSONArray("artifacts");
        if (artifacts == null || artifacts.length() == 0 || artifacts.length() > 32) throw new IllegalArgumentException("model_artifacts_invalid");
        long total = 0;
        boolean runnable = false;
        for (int index = 0; index < artifacts.length(); index++) {
            JSONObject artifact = artifacts.getJSONObject(index);
            ModelDownloadPolicy.requireInitialUrl(artifact.optString("downloadUrl"));
            artifact.put("sha256", ModelDownloadPolicy.requireSha256(artifact.optString("sha256")));
            long size = ModelDownloadPolicy.requireSize(artifact.optLong("sizeBytes", -1));
            total = Math.addExact(total, size);
            if (total > ModelDownloadPolicy.MAX_MODEL_BYTES) throw new IllegalArgumentException("model_too_large");
            String path = artifact.optString("path");
            ModelDownloadPolicy.resolveArtifact(store.modelDirectory(job), path);
            artifact.put("completedBytes", Math.max(0, artifact.optLong("completedBytes", 0)));
            runnable |= "litertlm".equals(artifact.optString("format")) || path.toLowerCase().endsWith(".litertlm");
            runnable |= "tflite".equals(artifact.optString("format")) || path.toLowerCase().endsWith(".tflite");
        }
        if (!runnable) throw new IllegalArgumentException("runnable_model_artifact_required");
        job.put("id", id).put("status", "queued").put("bytesTotal", total).put("bytesDownloaded", 0).put("updatedAt", System.currentTimeMillis());
        return job;
    }

    private void enqueueWork(String jobId) {
        Constraints constraints = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).setRequiresStorageNotLow(true).build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(YachiyoModelDownloadWorker.class)
            .setConstraints(constraints)
            .setInputData(new Data.Builder().putString(YachiyoModelDownloadWorker.KEY_JOB_ID, jobId).build())
            .addTag(workName(jobId))
            .build();
        WorkManager.getInstance(getContext()).enqueueUniqueWork(workName(jobId), ExistingWorkPolicy.REPLACE, request);
    }

    private static String workName(String id) {
        return "yachiyo-model-" + id;
    }

    private static String requireJobId(String value) {
        if (value == null || !value.matches("[A-Za-z0-9._-]{1,100}")) throw new IllegalArgumentException("model_job_id_invalid");
        return value;
    }

    private static String safeError(Exception error) {
        String message = error.getMessage();
        return message != null && message.matches("[A-Za-z0-9._-]{1,120}") ? message : "model_manager_failed";
    }
}
