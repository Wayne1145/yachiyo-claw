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
import android.content.Intent;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import androidx.work.Constraints;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Data;
import io.github.yachiyoclaw.download.DownloadTaskStore;
import io.github.yachiyoclaw.download.DownloadTransfer;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "YachiyoModelManager")
public final class YachiyoModelManagerPlugin extends Plugin {
    // Generous overall ceiling for a slow device loading a large model; the process must at least appear quickly.
    private static final long INFERENCE_TIMEOUT_MS = 30L * 60L * 1000L;
    private static final long STARTUP_TIMEOUT_MS = 20L * 1000L;
    private static final long STALE_INFERENCE_FILE_MS = 2L * 60L * 60L * 1000L;
    private final ExecutorService inferenceExecutor = Executors.newSingleThreadExecutor();
    // Request ids the caller asked to cancel; observed by the polling loop for a clean cancelled state.
    private final Set<String> cancelledRequests = ConcurrentHashMap.newKeySet();
    private ModelRegistryStore store;

    @Override
    public void load() {
        store = new ModelRegistryStore(getContext());
        clearStaleInferenceFiles();
    }

    /** Drop IPC files left behind by an inference process that was killed before the caller consumed them. */
    private void clearStaleInferenceFiles() {
        if (isInferenceProcessRunning()) return;
        File directory = new File(getContext().getCacheDir(), "local-inference");
        File[] files = directory.listFiles();
        long cutoff = System.currentTimeMillis() - STALE_INFERENCE_FILE_MS;
        if (files != null) for (File file : files) if (file.lastModified() < cutoff) file.delete();
    }

    @PluginMethod
    public void capabilities(PluginCall call) {
        JSObject result = new JSObject();
        result.put("schemaVersion", 1);
        result.put("runtimes", new JSArray().put("litert-lm").put("llama.cpp").put("mediapipe-text"));
        result.put("formats", new JSArray().put("litertlm").put("gguf").put("tflite"));
        result.put("maxConcurrentFiles", 1);
        result.put("maxConcurrentSegments", io.github.yachiyoclaw.download.YachiyoDownloadSettingsPlugin.threads(getContext()));
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
        result.put("supportedRuntimes", new JSArray().put("litert-lm").put("llama.cpp").put("mediapipe-text"));
        result.put("supportedFormats", new JSArray().put("litertlm").put("gguf").put("tflite"));
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
            DownloadTaskStore.update(
                getContext(),
                job.optString("id"),
                "model",
                job.optString("repository", "本地模型"),
                "queued",
                job.optLong("bytesDownloaded", 0),
                job.optLong("bytesTotal", 0),
                0,
                null
            );
            enqueueWork(getContext(), job.optString("id"));
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
            long downloaded = job.optLong("bytesDownloaded", 0);
            store.update(jobId, "queued", downloaded, null, null);
            DownloadTaskStore.update(
                getContext(), jobId, "model", job.optString("repository", "本地模型"), "queued",
                downloaded, job.optLong("bytesTotal", 0), 0, null
            );
            enqueueWork(getContext(), jobId);
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
                enqueueWork(getContext(), job.optString("id"));
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
            File model;
            try {
                model = store.resolveRuntimeFile(job);
            } catch (Exception error) {
                result.put("status", "unsupported").put("reason", safeError(error));
                call.resolve(result);
                return;
            }
            String runtime = LocalModelFormat.runtimeForPath(model.getPath());
            boolean headerHealthy = !"llama.cpp".equals(runtime) || LocalModelFormat.hasValidGgufHeader(model);
            boolean shardsHealthy = !"llama.cpp".equals(runtime) || LocalModelFormat.hasCompleteGgufShardSet(model);
            boolean formatHealthy = runtime != null && headerHealthy && shardsHealthy;
            result.put("status", model.isFile() && formatHealthy ? "supported" : "unsupported");
            if (!model.isFile()) result.put("reason", "local_model_file_missing");
            else if (runtime == null) result.put("reason", "local_model_format_unsupported");
            else if (!headerHealthy) result.put("reason", "local_model_header_invalid");
            else if (!shardsHealthy) result.put("reason", "local_model_shard_missing");
            else result.put("runtime", runtime);
        }
        call.resolve(result);
    }

    @PluginMethod
    public void modelCapabilities(PluginCall call) {
        String modelId = call.getString("modelId", "");
        JSONObject job = store.findCompletedModel(modelId);
        if (job == null) {
            call.reject("local_model_not_downloaded");
            return;
        }
        JSONObject stored = job.optJSONObject("runtimeCapabilities");
        JSObject capabilities = new JSObject();
        capabilities.put("text", stored == null || stored.optBoolean("text", true));
        capabilities.put("vision", stored != null && stored.optBoolean("vision", false));
        capabilities.put("audioInput", stored != null && stored.optBoolean("audioInput", false));
        capabilities.put("speechOutput", stored != null && stored.optBoolean("speechOutput", false));
        capabilities.put("reasoning", stored != null && stored.optBoolean("reasoning", false));
        capabilities.put("toolUse", stored != null && stored.optBoolean("toolUse", false));
        capabilities.put("streaming", stored != null && stored.optBoolean("streaming", false));
        capabilities.put("reasons", stored == null ? new JSONArray() : stored.optJSONArray("reasons"));
        call.resolve(capabilities);
    }

    @PluginMethod
    public void infer(PluginCall call) {
        String modelId = call.getString("modelId", "");
        String requestId = call.getString("requestId", "");
        JSArray messages = call.getArray("messages", new JSArray());
        JSObject tools = call.getObject("tools", new JSObject());
        int maxTokens = call.getInt("maxTokens", 2048);
        inferenceExecutor.execute(() -> {
            try {
                JSONObject job = store.findCompletedModel(modelId);
                if (job == null) throw new IllegalArgumentException("local_model_not_downloaded");
                String modelPath = store.resolveRuntimeFile(job).getPath();
                if (LocalModelFormat.isRunnableGgufPath(modelPath)) requireInferenceMemory(modelPath);
                JSONObject payload = new JSONObject().put("op", "chat").put("modelPath", modelPath)
                    .put("messages", new JSONArray(messages.toString()))
                    .put("tools", new JSONObject(tools.toString())).put("requestId", requestId).put("maxTokens", maxTokens);
                JSObject result = runInIsolatedProcess(payload, requestId);
                if (!requestId.isBlank()) result.put("requestId", requestId);
                call.resolve(result);
            } catch (Throwable error) {
                Exception cause = error instanceof Exception ? (Exception) error : new RuntimeException(error);
                call.reject(safeError(error), cause);
            }
        });
    }

    @PluginMethod
    public void cancelInference(PluginCall call) {
        String requestId = call.getString("requestId", "");
        // Flag the request so the polling loop reports a clean cancellation, then stop the native work.
        if (requestId != null && !requestId.isEmpty()) cancelledRequests.add(requestId);
        getContext().startService(new Intent(getContext(), LocalInferenceService.class)
            .setAction(LocalInferenceService.ACTION_CANCEL)
            .putExtra(LocalInferenceService.EXTRA_REQUEST_ID, requestId));
        call.resolve(new JSObject().put("cancelled", true));
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
                // Embedding uses the same disposable-process isolation as chat so a TFLite/MediaPipe native fault cannot kill the UI.
                String requestId = java.util.UUID.randomUUID().toString();
                JSONObject payload = new JSONObject().put("op", "embed").put("modelPath", modelPath)
                    .put("texts", new JSONArray(texts.toString())).put("requestId", requestId);
                JSObject result = runInIsolatedProcess(payload, requestId);
                call.resolve(new JSObject().put("modelId", modelId).put("embeddings", result.getJSONArray("embeddings")));
            } catch (Exception error) {
                call.reject(safeError(error), error);
            }
        });
    }

    /**
     * Writes the request to app-private storage, starts the {@code :local_model} process, and waits for a
     * result or error file. Detects: a startup that never produces the process, a process that crashes
     * after being observed (native SIGSEGV), an explicit user cancellation, and the overall timeout.
     * Temporary files are always removed.
     */
    private JSObject runInIsolatedProcess(JSONObject payload, String requestId) throws Exception {
        File directory = new File(getContext().getCacheDir(), "local-inference");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("local_inference_storage_unavailable");
        String safeId = requestId != null && requestId.matches("[A-Za-z0-9._-]{1,100}") ? requestId : java.util.UUID.randomUUID().toString();
        File request = new File(directory, safeId + ".json");
        File resultFile = new File(request.getPath() + ".result");
        File errorFile = new File(request.getPath() + ".error");
        Files.deleteIfExists(resultFile.toPath());
        Files.deleteIfExists(errorFile.toPath());
        boolean track = requestId != null && !requestId.isEmpty();
        if (track) cancelledRequests.remove(requestId); // clear any stale flag before a fresh run
        try {
            Files.write(request.toPath(), payload.toString().getBytes(StandardCharsets.UTF_8));
            getContext().startService(new Intent(getContext(), LocalInferenceService.class).putExtra(LocalInferenceService.EXTRA_REQUEST, request.getAbsolutePath()));
            long startedAt = System.currentTimeMillis();
            long deadline = startedAt + INFERENCE_TIMEOUT_MS;
            boolean processSeen = false;
            while (!resultFile.isFile() && !errorFile.isFile()) {
                if (track && cancelledRequests.remove(requestId)) throw new IllegalStateException("local_inference_cancelled");
                boolean running = isInferenceProcessRunning();
                processSeen |= running;
                if (processSeen && !running) throw new IllegalStateException("local_inference_process_crashed");
                long now = System.currentTimeMillis();
                // Fast-fail when the isolated process never even appears (e.g. it crashed on spawn).
                if (!processSeen && now - startedAt > STARTUP_TIMEOUT_MS) throw new IllegalStateException("local_inference_start_timeout");
                if (now > deadline) throw new IllegalStateException("local_inference_timeout");
                Thread.sleep(100);
            }
            if (errorFile.isFile()) throw new IllegalStateException(new String(Files.readAllBytes(errorFile.toPath()), StandardCharsets.US_ASCII));
            return new JSObject(new String(Files.readAllBytes(resultFile.toPath()), StandardCharsets.UTF_8));
        } finally {
            if (track) cancelledRequests.remove(requestId);
            resultFile.delete();
            errorFile.delete();
            request.delete();
        }
    }

    @PluginMethod
    public void unload(PluginCall call) {
        inferenceExecutor.execute(() -> {
            getContext().startService(new Intent(getContext(), LocalInferenceService.class).setAction(LocalInferenceService.ACTION_UNLOAD));
            call.resolve();
        });
    }

    @PluginMethod
    public void deleteModel(PluginCall call) {
        try {
            getContext().startService(new Intent(getContext(), LocalInferenceService.class).setAction(LocalInferenceService.ACTION_UNLOAD));
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
            long downloaded = job.optLong("bytesDownloaded", 0);
            // Persist the terminal state before cancelling WorkManager so an in-flight worker can no
            // longer commit progress after the user cancels the task.
            store.update(jobId, status, downloaded, null, null);
            if (cancelWork) WorkManager.getInstance(getContext()).cancelUniqueWork(workName(jobId));
            if ("cancelled".equals(status)) {
                discardDownloadArtifacts(job);
                downloaded = 0;
                store.update(jobId, status, 0, null, null);
            }
            DownloadTaskStore.update(
                getContext(),
                jobId,
                "model",
                job.optString("repository", "本地模型"),
                status,
                downloaded,
                job.optLong("bytesTotal", 0),
                0,
                null
            );
            call.resolve(new JSObject().put("accepted", true).put("jobId", jobId));
        } catch (Exception error) {
            call.reject(safeError(error), error);
        }
    }

    private void discardDownloadArtifacts(JSONObject job) throws Exception {
        File directory = store.modelDirectory(job);
        JSONArray artifacts = job.optJSONArray("artifacts");
        if (artifacts == null) return;
        for (int index = 0; index < artifacts.length(); index++) {
            JSONObject artifact = artifacts.optJSONObject(index);
            if (artifact == null) continue;
            DownloadTransfer.discard(ModelDownloadPolicy.resolveArtifact(directory, artifact.optString("path")));
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
            runnable |= LocalModelFormat.isRunnableArtifact(artifact.optString("format"), path);
        }
        if (!runnable) throw new IllegalArgumentException("runnable_model_artifact_required");
        job.put("id", id).put("status", "queued").put("bytesTotal", total).put("bytesDownloaded", 0).put("updatedAt", System.currentTimeMillis());
        return job;
    }

    private static void enqueueWork(android.content.Context context, String jobId) {
        Constraints constraints = io.github.yachiyoclaw.download.YachiyoDownloadSettingsPlugin.constraints(context);
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(YachiyoModelDownloadWorker.class)
            .setConstraints(constraints)
            .setInputData(new Data.Builder().putString(YachiyoModelDownloadWorker.KEY_JOB_ID, jobId).build())
            .addTag(workName(jobId))
            .build();
        WorkManager.getInstance(context).enqueueUniqueWork(workName(jobId), ExistingWorkPolicy.REPLACE, request);
    }

    /** Replaces active model workers after the global Wi-Fi-only constraint changes. */
    public static void reapplyActiveDownloadConstraints(android.content.Context context) {
        JSONArray jobs = new ModelRegistryStore(context).list();
        for (int index = 0; index < jobs.length(); index++) {
            JSONObject job = jobs.optJSONObject(index);
            if (job == null) continue;
            String status = job.optString("status", "");
            if ("queued".equals(status) || "downloading".equals(status)) {
                enqueueWork(context, requireJobId(job.optString("id")));
            }
        }
    }

    private static String workName(String id) {
        return "yachiyo-model-" + id;
    }

    private static String requireJobId(String value) {
        if (value == null || !value.matches("[A-Za-z0-9._-]{1,100}")) throw new IllegalArgumentException("model_job_id_invalid");
        return value;
    }

    private void requireInferenceMemory(String modelPath) {
        File model = new File(modelPath);
        ActivityManager manager = getContext().getSystemService(ActivityManager.class);
        ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
        manager.getMemoryInfo(memory);
        // llama.cpp mmaps the weights (so it does not need file-size RAM) but still needs KV cache, compute
        // buffers and allocator headroom. This is a heuristic floor pending calibration on real 2B/4B GGUF
        // models; the disposable :local_model process contains a genuine native OOM if the estimate is low.
        long required = Math.max(768L * 1024L * 1024L, 512L * 1024L * 1024L + model.length() / 6L);
        if (memory.availMem < required || memory.lowMemory) throw new IllegalStateException("local_model_memory_insufficient");
    }

    private boolean isInferenceProcessRunning() {
        ActivityManager manager = getContext().getSystemService(ActivityManager.class);
        java.util.List<ActivityManager.RunningAppProcessInfo> processes = manager.getRunningAppProcesses();
        if (processes == null) return false;
        String expected = getContext().getPackageName() + ":local_model";
        for (ActivityManager.RunningAppProcessInfo process : processes) if (expected.equals(process.processName)) return true;
        return false;
    }

    private static String safeError(Throwable error) {
        String message = error.getMessage();
        return message != null && message.matches("[A-Za-z0-9._-]{1,120}") ? message : "model_manager_failed";
    }
}
