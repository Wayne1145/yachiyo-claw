package io.github.yachiyoclaw.model;

import android.app.Service;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.os.IBinder;
import android.os.Debug;
import android.os.Build;
import android.os.PerformanceHintManager;
import android.os.PowerManager;
import android.os.SystemClock;
import androidx.core.app.NotificationCompat;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;

/** Runs native model code in a disposable process so a vendor/native crash cannot kill the UI process. */
public final class LocalInferenceService extends Service {
    static final String EXTRA_REQUEST = "request";
    static final String ACTION_CANCEL = "io.github.yachiyoclaw.model.CANCEL";
    static final String ACTION_UNLOAD = "io.github.yachiyoclaw.model.UNLOAD";
    static final String EXTRA_REQUEST_ID = "requestId";
    private static final String CHANNEL_ID = "yachiyo-local-inference";
    private static final int NOTIFICATION_ID = 4816;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService monitorExecutor = Executors.newSingleThreadScheduledExecutor();
    private volatile String activeRuntime = "";
    private volatile String loadedRuntime = "";
    private volatile String loadedModelPath = "";
    private volatile boolean loadedEager = false;
    private volatile long loadedModelBytes = 0L;
    private volatile long loadedResidentBytes = 0L;
    private volatile long loadedDurationMs = 0L;
    private volatile JSONObject loadedAcceleration = new JSONObject();

    @Override public void onCreate() {
        super.onCreate();
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL_ID, "本地模型运行", NotificationManager.IMPORTANCE_LOW));
        startForeground(NOTIFICATION_ID, notification("本地模型运行时正在准备"));
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_CANCEL.equals(intent.getAction())) {
            if ("litert-lm".equals(activeRuntime)) {
                // LiteRT-LM has no cooperative cancellation API; killing only this disposable process is safe.
                android.os.Process.killProcess(android.os.Process.myPid());
                return START_NOT_STICKY;
            }
            GgufRunner.cancel(intent.getStringExtra(EXTRA_REQUEST_ID));
            return START_NOT_STICKY;
        }
        if (intent != null && ACTION_UNLOAD.equals(intent.getAction())) {
            if ("litert-lm".equals(activeRuntime)) {
                android.os.Process.killProcess(android.os.Process.myPid());
                return START_NOT_STICKY;
            }
            GgufRunner.cancel("");
            executor.execute(() -> {
                GgufRunner.unload();
                LiteRtLmRunner.unload();
                MediaPipeTextEmbeddingRunner.unload();
                loadedRuntime = "";
                loadedModelPath = "";
                loadedEager = false;
                loadedModelBytes = 0L;
                loadedResidentBytes = 0L;
                loadedDurationMs = 0L;
                loadedAcceleration = new JSONObject();
                stopForeground(STOP_FOREGROUND_REMOVE);
                stopSelf(startId);
            });
            return START_NOT_STICKY;
        }
        String request = intent == null ? null : intent.getStringExtra(EXTRA_REQUEST);
        if (request != null) executor.execute(() -> run(new File(request), startId));
        return START_NOT_STICKY;
    }

    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onDestroy() {
        monitorExecutor.shutdownNow();
        executor.shutdownNow();
        LiteRtLmRunner.unload();
        GgufRunner.unload();
        MediaPipeTextEmbeddingRunner.unload();
        super.onDestroy();
    }

    private android.app.Notification notification(String text) {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(getApplicationInfo().icon)
            .setContentTitle("Yachiyo Claw 本地模型")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build();
    }

    private void updateNotification(String text) {
        getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification(text));
    }

    private void run(File requestFile, int startId) {
        PowerManager.WakeLock wakeLock = null;
        PerformanceHintManager.Session hintSession = null;
        long workStartedNanos = System.nanoTime();
        PowerManager powerManager = getSystemService(PowerManager.class);
        if (powerManager != null) {
            wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, getPackageName() + ":local-model");
            wakeLock.acquire(TimeUnit.MINUTES.toMillis(30));
        }
        if (Build.VERSION.SDK_INT >= 31) {
            PerformanceHintManager hintManager = getSystemService(PerformanceHintManager.class);
            if (hintManager != null) {
                hintSession = hintManager.createHintSession(new int[] { android.os.Process.myTid() }, 16_666_667L);
            }
        }
        File resultTemp = new File(requestFile.getPath() + ".result.tmp");
        File resultFile = new File(requestFile.getPath() + ".result");
        File errorFile = new File(requestFile.getPath() + ".error");
        File heartbeatFile = new File(requestFile.getPath() + ".heartbeat");
        File progressFile = new File(requestFile.getPath() + ".progress");
        AtomicReference<String> stage = new AtomicReference<>("starting");
        ScheduledFuture<?> monitor = monitorExecutor.scheduleAtFixedRate(() -> {
            try {
                Files.write(heartbeatFile.toPath(), Long.toString(System.currentTimeMillis()).getBytes(StandardCharsets.US_ASCII));
                int percent = "llama.cpp".equals(activeRuntime)
                    ? Math.round(GgufRunner.loadProgress() * 100.0F)
                    : ("ready".equals(stage.get()) || "generating".equals(stage.get()) ? 100 : 15);
                JSONObject progress = new JSONObject().put("stage", stage.get()).put("percent", Math.max(0, Math.min(100, percent)));
                Files.write(progressFile.toPath(), progress.toString().getBytes(StandardCharsets.UTF_8));
            } catch (Throwable ignored) {
                // The caller also has an overall timeout; progress reporting must never abort inference.
            }
        }, 0L, 250L, TimeUnit.MILLISECONDS);
        try {
            JSONObject request = new JSONObject(new String(Files.readAllBytes(requestFile.toPath()), StandardCharsets.UTF_8));
            String op = request.optString("op", "chat");
            String modelPath = request.getString("modelPath");
            String requestId = request.optString("requestId");
            JSONObject configuration = request.optJSONObject("configuration");
            if (configuration == null) configuration = new JSONObject();
            String selectedBackend = configuration.optString("selectedBackend", AccelerationPolicy.BACKEND_CPU);
            int cpuThreads = Math.max(1, configuration.optInt("cpuThreads", Math.min(8, Runtime.getRuntime().availableProcessors())));
            int gpuLayers = Math.max(0, configuration.optInt("gpuLayers", 0));
            boolean declaredNpuCompatible = configuration.optBoolean("declaredNpuCompatible", false);
            JSONObject result;
            if ("benchmark".equals(op)) {
                stage.set("benchmarking");
                result = benchmark(request, modelPath);
            } else if ("embed".equals(op)) {
                stage.set("embedding");
                JSONArray vectors = MediaPipeTextEmbeddingRunner.embed(this, modelPath, request.getJSONArray("texts"));
                result = new JSONObject().put("embeddings", vectors);
            } else if ("load".equals(op)) {
                stage.set("loading");
                long loadStartedAt = SystemClock.elapsedRealtime();
                boolean eager = request.optBoolean("eager", false);
                if (modelPath.toLowerCase().endsWith(".litertlm")) {
                    activeRuntime = "litert-lm";
                    LiteRtLmRunner.load(this, modelPath, selectedBackend, declaredNpuCompatible, cpuThreads);
                    loadedRuntime = "litert-lm";
                    eager = true;
                } else if (LocalModelFormat.isRunnableGgufPath(modelPath)) {
                    activeRuntime = "llama.cpp";
                    GgufRunner.load(modelPath, request.optString("requestId"), eager, gpuLayers, cpuThreads);
                    loadedRuntime = "llama.cpp";
                } else throw new IllegalArgumentException("local_model_not_chat_model");
                loadedModelPath = modelPath;
                loadedEager = eager;
                loadedModelBytes = new File(modelPath).length();
                loadedDurationMs = Math.max(0L, SystemClock.elapsedRealtime() - loadStartedAt);
                loadedResidentBytes = processResidentBytes();
                loadedAcceleration = accelerationResult(configuration);
                stage.set("ready");
                updateNotification("本地模型已加载到内存");
                result = runtimeResult(true);
            } else if ("status".equals(op)) {
                boolean loaded = !loadedModelPath.isEmpty() && loadedModelPath.equals(modelPath);
                JSONArray modelPaths = request.optJSONArray("modelPaths");
                if (!loaded && modelPaths != null) for (int index = 0; index < modelPaths.length(); index++) {
                    if (loadedModelPath.equals(modelPaths.optString(index))) { loaded = true; break; }
                }
                stage.set(loaded ? "ready" : "idle");
                result = runtimeResult(loaded);
            } else {
                JSONArray messages = request.getJSONArray("messages");
                JSONObject tools = request.optJSONObject("tools");
                if (tools == null) tools = new JSONObject();
                int maxTokens = request.optInt("maxTokens", 2048);
                boolean retainedEagerLoad = loadedModelPath.equals(modelPath) && loadedEager;
                JSONArray events;
                if (modelPath.toLowerCase().endsWith(".litertlm")) {
                    activeRuntime = "litert-lm";
                    stage.set(loadedModelPath.equals(modelPath) ? "generating" : "loading");
                    events = LiteRtLmRunner.infer(
                        this, modelPath, messages, tools, requestId, maxTokens,
                        selectedBackend, declaredNpuCompatible, cpuThreads);
                    loadedRuntime = "litert-lm";
                } else if (LocalModelFormat.isRunnableGgufPath(modelPath)) {
                    activeRuntime = "llama.cpp";
                    stage.set(loadedModelPath.equals(modelPath) ? "generating" : "loading");
                    JSONArray preparedMessages = LocalToolProtocol.prepareMessages(messages, tools);
                    String text = GgufRunner.infer(
                        modelPath, preparedMessages, maxTokens, requestId, gpuLayers, cpuThreads);
                    events = LocalToolProtocol.parseEvents(text, tools, requestId);
                    loadedRuntime = "llama.cpp";
                }
                else throw new IllegalArgumentException("local_model_not_chat_model");
                loadedModelPath = modelPath;
                loadedEager = retainedEagerLoad;
                if (!retainedEagerLoad) loadedDurationMs = 0L;
                loadedModelBytes = new File(modelPath).length();
                loadedResidentBytes = processResidentBytes();
                loadedAcceleration = accelerationResult(configuration);
                stage.set("ready");
                updateNotification(loadedEager ? "本地模型已完整加载到内存" : "本地模型已就绪（按需映射）");
                result = new JSONObject().put("events", events)
                    .put("acceleration", loadedAcceleration);
            }
            // Write then rename so the UI process never observes a half-written result file.
            Files.write(resultTemp.toPath(), result.toString().getBytes(StandardCharsets.UTF_8));
            Files.move(resultTemp.toPath(), resultFile.toPath(), StandardCopyOption.REPLACE_EXISTING);
        } catch (Throwable error) {
            // Only Java-level faults land here; a native SIGSEGV kills just this process and is detected by the caller.
            try { Files.write(errorFile.toPath(), safe(error).getBytes(StandardCharsets.US_ASCII)); } catch (Exception ignored) {}
        } finally {
            if (hintSession != null) {
                hintSession.reportActualWorkDuration(Math.max(1L, System.nanoTime() - workStartedNanos));
                hintSession.close();
            }
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
            monitor.cancel(true);
            activeRuntime = "";
            resultTemp.delete();
            heartbeatFile.delete();
            progressFile.delete();
            requestFile.delete();
            if (loadedModelPath.isEmpty()) {
                stopForeground(STOP_FOREGROUND_REMOVE);
                stopSelf(startId);
            }
        }
    }

    private static String safe(Throwable error) { String value = error.getMessage(); return value != null && value.matches("[A-Za-z0-9._-]{1,120}") ? value : "local_inference_failed"; }

    private JSONObject runtimeResult(boolean loaded) throws org.json.JSONException {
        return new JSONObject()
            .put("loaded", loaded)
            .put("runtime", loaded ? loadedRuntime : "")
            .put("eager", loaded && loadedEager)
            .put("modelBytes", loaded ? loadedModelBytes : 0L)
            .put("residentBytes", loaded ? loadedResidentBytes : 0L)
            .put("loadDurationMs", loaded ? loadedDurationMs : 0L)
            .put("acceleration", loaded ? loadedAcceleration : new JSONObject());
    }

    private JSONObject benchmark(JSONObject request, String modelPath) throws Exception {
        String backend = AccelerationPolicy.normalizeBackend(request.optString("backend"));
        int cpuThreads = Math.max(1, request.optInt("cpuThreads", Math.min(8, Runtime.getRuntime().availableProcessors())));
        boolean npuCompatible = request.optBoolean("declaredNpuCompatible", false);
        JSONObject result;
        if (modelPath.toLowerCase().endsWith(".litertlm")) {
            activeRuntime = "litert-lm";
            result = LiteRtLmRunner.benchmarkBackend(this, modelPath, backend, npuCompatible, cpuThreads);
            result.put("gpuLayers", 0).put("cpuThreads", cpuThreads);
        } else if (LocalModelFormat.isRunnableGgufPath(modelPath)) {
            activeRuntime = "llama.cpp";
            int layerCount = GgufRunner.layerCount(modelPath);
            int percent = Math.max(0, Math.min(100, request.optInt("gpuLayerPercent", 0)));
            int layers = AccelerationPolicy.BACKEND_GPU.equals(backend)
                ? Math.max(1, (int) Math.floor(layerCount * percent / 100.0d)) : 0;
            long loadStarted = SystemClock.elapsedRealtime();
            GgufRunner.load(modelPath, "benchmark-load", false, layers, cpuThreads);
            long initializationMs = Math.max(0L, SystemClock.elapsedRealtime() - loadStarted);
            JSONArray messages = new JSONArray().put(new JSONObject()
                .put("role", "user").put("content", "Reply with a concise factual sentence about Android."));
            GgufRunner.infer(modelPath, messages, 32, "benchmark-infer", layers, cpuThreads);
            result = GgufRunner.runtimeMetrics()
                .put("initializationMs", initializationMs)
                .put("backend", layers > 0 ? AccelerationPolicy.BACKEND_GPU : AccelerationPolicy.BACKEND_CPU)
                .put("gpuLayers", layers)
                .put("cpuThreads", cpuThreads);
            if (layers > 0 && !result.optString("activeBackend").contains("GPU")) {
                throw new IllegalStateException("gpu_benchmark_fell_back");
            }
        } else {
            throw new IllegalArgumentException("local_model_not_chat_model");
        }
        return result
            .put("modelPath", modelPath)
            .put("residentBytes", processResidentBytes())
            .put("thermalStatus", AccelerationRuntimeSupport.thermalStatus(this));
    }

    private JSONObject accelerationResult(JSONObject configuration) throws Exception {
        JSONObject profile = configuration.optJSONObject("profile");
        JSONObject result = profile == null || profile.optJSONObject("selected") == null
            ? new JSONObject() : new JSONObject(profile.optJSONObject("selected").toString());
        result.put("requestedBackend", configuration.optString("requestedBackend", AccelerationPolicy.BACKEND_AUTO));
        result.put("mode", configuration.optString("mode", AccelerationPolicy.MODE_AUTO));
        result.put("modelVariant", configuration.optString("modelVariant"));
        result.put("thermalStatus", AccelerationRuntimeSupport.thermalStatus(this));
        String policyFallback = configuration.optString("policyFallbackReason");
        if ("litert-lm".equals(loadedRuntime)) {
            result.put("activeBackend", LiteRtLmRunner.activeBackend());
            String runtimeFallback = LiteRtLmRunner.fallbackReason();
            result.put("fallbackReason", runtimeFallback == null || runtimeFallback.isBlank() ? policyFallback : runtimeFallback);
        } else if ("llama.cpp".equals(loadedRuntime)) {
            JSONObject runtime = GgufRunner.runtimeMetrics();
            for (java.util.Iterator<String> keys = runtime.keys(); keys.hasNext();) {
                String key = keys.next();
                result.put(key, runtime.opt(key));
            }
            if (result.optString("fallbackReason").isBlank()) result.put("fallbackReason", policyFallback);
        }
        return result;
    }

    private static long processResidentBytes() {
        Debug.MemoryInfo memory = new Debug.MemoryInfo();
        Debug.getMemoryInfo(memory);
        return Math.max(0L, memory.getTotalPss()) * 1024L;
    }
}
