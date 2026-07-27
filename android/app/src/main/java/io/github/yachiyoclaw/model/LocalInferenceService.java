package io.github.yachiyoclaw.model;

import android.app.Service;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.os.IBinder;
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
            JSONObject result;
            if ("embed".equals(op)) {
                stage.set("embedding");
                JSONArray vectors = MediaPipeTextEmbeddingRunner.embed(this, modelPath, request.getJSONArray("texts"));
                result = new JSONObject().put("embeddings", vectors);
            } else if ("load".equals(op)) {
                stage.set("loading");
                if (modelPath.toLowerCase().endsWith(".litertlm")) {
                    activeRuntime = "litert-lm";
                    LiteRtLmRunner.load(modelPath);
                    loadedRuntime = "litert-lm";
                } else if (LocalModelFormat.isRunnableGgufPath(modelPath)) {
                    activeRuntime = "llama.cpp";
                    GgufRunner.load(modelPath, request.optString("requestId"));
                    loadedRuntime = "llama.cpp";
                } else throw new IllegalArgumentException("local_model_not_chat_model");
                loadedModelPath = modelPath;
                stage.set("ready");
                updateNotification("本地模型已加载到内存");
                result = new JSONObject().put("loaded", true).put("runtime", loadedRuntime);
            } else if ("status".equals(op)) {
                boolean loaded = !loadedModelPath.isEmpty() && loadedModelPath.equals(modelPath);
                stage.set(loaded ? "ready" : "idle");
                result = new JSONObject().put("loaded", loaded).put("runtime", loaded ? loadedRuntime : "");
            } else {
                JSONArray messages = request.getJSONArray("messages");
                JSONObject tools = request.optJSONObject("tools");
                if (tools == null) tools = new JSONObject();
                int maxTokens = request.optInt("maxTokens", 2048);
                JSONArray events;
                if (modelPath.toLowerCase().endsWith(".litertlm")) {
                    activeRuntime = "litert-lm";
                    stage.set(loadedModelPath.equals(modelPath) ? "generating" : "loading");
                    events = LiteRtLmRunner.infer(modelPath, messages, tools, requestId, maxTokens);
                    loadedRuntime = "litert-lm";
                } else if (LocalModelFormat.isRunnableGgufPath(modelPath)) {
                    activeRuntime = "llama.cpp";
                    stage.set(loadedModelPath.equals(modelPath) ? "generating" : "loading");
                    JSONArray preparedMessages = LocalToolProtocol.prepareMessages(messages, tools);
                    String text = GgufRunner.infer(modelPath, preparedMessages, maxTokens, requestId);
                    events = LocalToolProtocol.parseEvents(text, tools, requestId);
                    loadedRuntime = "llama.cpp";
                }
                else throw new IllegalArgumentException("local_model_not_chat_model");
                loadedModelPath = modelPath;
                stage.set("ready");
                updateNotification("本地模型已加载到内存");
                result = new JSONObject().put("events", events);
            }
            // Write then rename so the UI process never observes a half-written result file.
            Files.write(resultTemp.toPath(), result.toString().getBytes(StandardCharsets.UTF_8));
            Files.move(resultTemp.toPath(), resultFile.toPath(), StandardCopyOption.REPLACE_EXISTING);
        } catch (Throwable error) {
            // Only Java-level faults land here; a native SIGSEGV kills just this process and is detected by the caller.
            try { Files.write(errorFile.toPath(), safe(error).getBytes(StandardCharsets.US_ASCII)); } catch (Exception ignored) {}
        } finally {
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
}
