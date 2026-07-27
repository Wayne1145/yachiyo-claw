package io.github.yachiyoclaw.model;

import android.app.Service;
import android.content.Intent;
import android.os.IBinder;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

/** Runs native model code in a disposable process so a vendor/native crash cannot kill the UI process. */
public final class LocalInferenceService extends Service {
    static final String EXTRA_REQUEST = "request";
    static final String ACTION_CANCEL = "io.github.yachiyoclaw.model.CANCEL";
    static final String ACTION_UNLOAD = "io.github.yachiyoclaw.model.UNLOAD";
    static final String EXTRA_REQUEST_ID = "requestId";
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private volatile String activeRuntime = "";

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_CANCEL.equals(intent.getAction())) {
            if ("litert-lm".equals(activeRuntime)) {
                // LiteRT-LM has no cooperative cancellation API; killing only this disposable process is safe.
                android.os.Process.killProcess(android.os.Process.myPid());
                return START_NOT_STICKY;
            }
            // Cancel from the service thread, then close only after the serial inference task has unwound.
            GgufRunner.cancel(intent.getStringExtra(EXTRA_REQUEST_ID));
            executor.execute(() -> stopSelf(startId));
            return START_NOT_STICKY;
        }
        if (intent != null && ACTION_UNLOAD.equals(intent.getAction())) {
            if ("litert-lm".equals(activeRuntime)) {
                android.os.Process.killProcess(android.os.Process.myPid());
                return START_NOT_STICKY;
            }
            GgufRunner.cancel("");
            executor.execute(() -> stopSelf(startId));
            return START_NOT_STICKY;
        }
        String request = intent == null ? null : intent.getStringExtra(EXTRA_REQUEST);
        if (request != null) executor.execute(() -> run(new File(request), startId));
        return START_NOT_STICKY;
    }

    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onDestroy() { executor.shutdownNow(); LiteRtLmRunner.unload(); GgufRunner.unload(); MediaPipeTextEmbeddingRunner.unload(); super.onDestroy(); }

    private void run(File requestFile, int startId) {
        File resultTemp = new File(requestFile.getPath() + ".result.tmp");
        File resultFile = new File(requestFile.getPath() + ".result");
        File errorFile = new File(requestFile.getPath() + ".error");
        try {
            JSONObject request = new JSONObject(new String(Files.readAllBytes(requestFile.toPath()), StandardCharsets.UTF_8));
            String op = request.optString("op", "chat");
            String modelPath = request.getString("modelPath");
            String requestId = request.optString("requestId");
            JSONObject result;
            if ("embed".equals(op)) {
                JSONArray vectors = MediaPipeTextEmbeddingRunner.embed(this, modelPath, request.getJSONArray("texts"));
                result = new JSONObject().put("embeddings", vectors);
            } else {
                JSONArray messages = request.getJSONArray("messages");
                JSONObject tools = request.optJSONObject("tools");
                if (tools == null) tools = new JSONObject();
                int maxTokens = request.optInt("maxTokens", 2048);
                JSONArray events;
                if (modelPath.toLowerCase().endsWith(".litertlm")) {
                    activeRuntime = "litert-lm";
                    events = LiteRtLmRunner.infer(modelPath, messages, tools, requestId, maxTokens);
                } else if (LocalModelFormat.isRunnableGgufPath(modelPath)) {
                    activeRuntime = "llama.cpp";
                    JSONArray preparedMessages = LocalToolProtocol.prepareMessages(messages, tools);
                    String text = GgufRunner.infer(modelPath, preparedMessages, maxTokens, requestId);
                    events = LocalToolProtocol.parseEvents(text, tools, requestId);
                }
                else throw new IllegalArgumentException("local_model_not_chat_model");
                result = new JSONObject().put("events", events);
            }
            // Write then rename so the UI process never observes a half-written result file.
            Files.write(resultTemp.toPath(), result.toString().getBytes(StandardCharsets.UTF_8));
            Files.move(resultTemp.toPath(), resultFile.toPath(), StandardCopyOption.REPLACE_EXISTING);
        } catch (Throwable error) {
            // Only Java-level faults land here; a native SIGSEGV kills just this process and is detected by the caller.
            try { Files.write(errorFile.toPath(), safe(error).getBytes(StandardCharsets.US_ASCII)); } catch (Exception ignored) {}
        } finally {
            activeRuntime = "";
            resultTemp.delete();
            requestFile.delete();
            stopSelf(startId);
        }
    }

    private static String safe(Throwable error) { String value = error.getMessage(); return value != null && value.matches("[A-Za-z0-9._-]{1,120}") ? value : "local_inference_failed"; }
}
