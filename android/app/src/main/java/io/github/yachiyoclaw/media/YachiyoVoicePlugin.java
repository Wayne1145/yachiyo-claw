package io.github.yachiyoclaw.media;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognitionService;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import androidx.annotation.RequiresApi;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@CapacitorPlugin(name = "YachiyoVoice", permissions = {
    @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
})
public class YachiyoVoicePlugin extends Plugin {
    private ActiveRecognition activeRecognition;
    private TextToSpeech tts;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Map<String, PluginCall> pendingSpeakCalls = new ConcurrentHashMap<>();

    private static final class ActiveRecognition {
        private final long id;
        private final PluginCall call;
        private final SpeechRecognizer recognizer;
        private String latestText = "";
        private boolean stopRequested;
        private boolean settled;

        private ActiveRecognition(long id, PluginCall call, SpeechRecognizer recognizer) {
            this.id = id;
            this.call = call;
            this.recognizer = recognizer;
        }
    }

    private long nextRecognitionId = 1;

    @PluginMethod
    public void getRecognitionStatus(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            boolean recognitionAvailable = SpeechRecognizer.isRecognitionAvailable(getContext());
            boolean onDeviceAvailable = isOnDeviceRecognitionAvailable();
            Intent serviceIntent = new Intent(RecognitionService.SERVICE_INTERFACE);
            int serviceCount = getContext().getPackageManager().queryIntentServices(serviceIntent, 0).size();
            JSObject result = new JSObject();
            result.put("recognitionAvailable", recognitionAvailable);
            result.put("onDeviceAvailable", onDeviceAvailable);
            result.put("serviceCount", serviceCount);
            result.put("listening", activeRecognition != null && !activeRecognition.settled);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void startListening(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "microphonePermissionCallback");
            return;
        }
        beginListening(call);
    }

    @PermissionCallback
    private void microphonePermissionCallback(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) beginListening(call);
        else call.reject("请授予麦克风权限后再使用语音输入。", "microphone_permission_denied");
    }

    private void beginListening(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
                call.reject("系统未安装或未启用语音识别服务，请安装语音服务或在语音设置中配置 ASR API。", "speech_service_unavailable");
                return;
            }
            cancelActiveRecognition("已开始新的语音识别。", "speech_recognition_replaced");
            boolean preferOnDevice = call.getBoolean("preferOnDevice", true);
            boolean canUseOnDevice = preferOnDevice && isOnDeviceRecognitionAvailable();
            final SpeechRecognizer recognizer;
            try {
                recognizer = canUseOnDevice
                    ? Api31SpeechRecognizer.createOnDevice(getContext())
                    : SpeechRecognizer.createSpeechRecognizer(getContext());
            } catch (RuntimeException error) {
                call.reject("无法启动系统语音识别服务。", "speech_recognizer_start_failed", error);
                return;
            }
            ActiveRecognition recognition = new ActiveRecognition(nextRecognitionId++, call, recognizer);
            activeRecognition = recognition;
            recognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle params) { notifyRecognitionState(recognition, "listening"); }
                @Override public void onBeginningOfSpeech() { notifyRecognitionState(recognition, "speech"); }
                @Override public void onRmsChanged(float rmsdB) {}
                @Override public void onBufferReceived(byte[] buffer) {}
                @Override public void onEndOfSpeech() { notifyRecognitionState(recognition, "processing"); }
                @Override public void onPartialResults(Bundle partialResults) {
                    String text = firstRecognitionText(partialResults);
                    if (text.isEmpty() || !isCurrent(recognition)) return;
                    recognition.latestText = text;
                    JSObject value = new JSObject();
                    value.put("sessionId", recognition.id);
                    value.put("text", text);
                    notifyListeners("speechPartialResult", value);
                }
                @Override public void onEvent(int eventType, Bundle params) {}
                @Override public void onError(int error) {
                    if (!isCurrent(recognition)) return;
                    if ((recognition.stopRequested && error == SpeechRecognizer.ERROR_CLIENT)
                        || (error == SpeechRecognizer.ERROR_NO_MATCH && !recognition.latestText.isEmpty())) {
                        resolveRecognition(recognition, recognition.latestText);
                        return;
                    }
                    rejectRecognition(recognition, speechErrorMessage(error), speechErrorCode(error));
                }
                @Override public void onResults(Bundle results) {
                    String text = firstRecognitionText(results);
                    resolveRecognition(recognition, text.isEmpty() ? recognition.latestText : text);
                }
            });
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, call.getString("language", "zh-CN"));
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
            intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, preferOnDevice);
            try {
                notifyRecognitionState(recognition, "starting");
                recognizer.startListening(intent);
            } catch (RuntimeException error) {
                rejectRecognition(recognition, "无法启动系统语音识别服务。", "speech_recognizer_start_failed");
            }
        });
    }

    @PluginMethod public void stopListening(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            ActiveRecognition recognition = activeRecognition;
            if (recognition != null && !recognition.settled) {
                recognition.stopRequested = true;
                try {
                    recognition.recognizer.stopListening();
                    notifyRecognitionState(recognition, "processing");
                    mainHandler.postDelayed(() -> {
                        if (isCurrent(recognition) && recognition.stopRequested) {
                            resolveRecognition(recognition, recognition.latestText);
                        }
                    }, 2000);
                } catch (RuntimeException error) {
                    resolveRecognition(recognition, recognition.latestText);
                }
            }
            call.resolve();
        });
    }

    private boolean isCurrent(ActiveRecognition recognition) {
        return activeRecognition == recognition && !recognition.settled;
    }

    private boolean isOnDeviceRecognitionAvailable() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return false;
        try {
            return Api31SpeechRecognizer.isOnDeviceAvailable(getContext());
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    @RequiresApi(Build.VERSION_CODES.S)
    private static final class Api31SpeechRecognizer {
        private static boolean isOnDeviceAvailable(android.content.Context context) {
            return SpeechRecognizer.isOnDeviceRecognitionAvailable(context);
        }

        private static SpeechRecognizer createOnDevice(android.content.Context context) {
            return SpeechRecognizer.createOnDeviceSpeechRecognizer(context);
        }
    }

    private static String firstRecognitionText(Bundle results) {
        if (results == null) return "";
        ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return matches == null || matches.isEmpty() || matches.get(0) == null ? "" : matches.get(0).trim();
    }

    private void notifyRecognitionState(ActiveRecognition recognition, String state) {
        if (!isCurrent(recognition)) return;
        JSObject value = new JSObject();
        value.put("sessionId", recognition.id);
        value.put("active", !"finished".equals(state));
        value.put("state", state);
        notifyListeners("speechRecognitionStateChanged", value);
    }

    private void resolveRecognition(ActiveRecognition recognition, String text) {
        if (!isCurrent(recognition)) return;
        recognition.settled = true;
        JSObject value = new JSObject();
        value.put("text", text == null ? "" : text.trim());
        recognition.call.resolve(value);
        disposeRecognition(recognition);
    }

    private void rejectRecognition(ActiveRecognition recognition, String message, String code) {
        if (!isCurrent(recognition)) return;
        recognition.settled = true;
        recognition.call.reject(message, code);
        disposeRecognition(recognition);
    }

    private void disposeRecognition(ActiveRecognition recognition) {
        if (activeRecognition == recognition) activeRecognition = null;
        try {
            recognition.recognizer.cancel();
        } catch (RuntimeException ignored) {
            // Some vendor recognizers throw while already shutting down.
        }
        recognition.recognizer.destroy();
        JSObject state = new JSObject();
        state.put("sessionId", recognition.id);
        state.put("active", false);
        state.put("state", "finished");
        notifyListeners("speechRecognitionStateChanged", state);
    }

    private void cancelActiveRecognition(String message, String code) {
        ActiveRecognition recognition = activeRecognition;
        if (recognition == null || recognition.settled) return;
        recognition.settled = true;
        recognition.call.reject(message, code);
        disposeRecognition(recognition);
    }

    static String speechErrorCode(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: return "speech_network_timeout";
            case SpeechRecognizer.ERROR_NETWORK: return "speech_network_error";
            case SpeechRecognizer.ERROR_AUDIO: return "speech_audio_error";
            case SpeechRecognizer.ERROR_SERVER: return "speech_server_error";
            case SpeechRecognizer.ERROR_CLIENT: return "speech_client_error";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "speech_timeout";
            case SpeechRecognizer.ERROR_NO_MATCH: return "speech_no_match";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: return "speech_recognizer_busy";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "speech_permission_denied";
            case 10: return "speech_too_many_requests";
            case 11: return "speech_server_disconnected";
            case 12: return "speech_language_not_supported";
            case 13: return "speech_language_unavailable";
            default: return "speech_recognition_error_" + error;
        }
    }

    static String speechErrorMessage(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: return "语音识别网络连接超时。";
            case SpeechRecognizer.ERROR_NETWORK: return "语音识别服务无法连接网络。";
            case SpeechRecognizer.ERROR_AUDIO: return "无法读取麦克风音频。";
            case SpeechRecognizer.ERROR_SERVER: return "语音识别服务暂时不可用。";
            case SpeechRecognizer.ERROR_CLIENT: return "语音识别被系统中断，请重试。";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "没有检测到语音，请重试。";
            case SpeechRecognizer.ERROR_NO_MATCH: return "没有识别出清晰的语音。";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: return "语音识别服务正忙，请稍后重试。";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "请授予麦克风权限后再使用语音输入。";
            case 10: return "语音识别请求过于频繁，请稍后重试。";
            case 11: return "语音识别服务连接已断开。";
            case 12: return "当前语音识别服务不支持所选语言。";
            case 13: return "所选语言的离线识别模型尚未下载。";
            default: return "语音识别失败（错误 " + error + "）。";
        }
    }

    @PluginMethod public void speak(PluginCall call) {
        String text = call.getString("text", "").trim();
        if (text.isEmpty()) { call.resolve(); return; }
        getActivity().runOnUiThread(() -> ensureTts(call, text));
    }

    private void ensureTts(PluginCall call, String text) {
        if (tts != null) { speakNow(call, text); return; }
        tts = new TextToSpeech(getContext(), status -> {
            if (status != TextToSpeech.SUCCESS) { call.reject("tts_initialization_failed"); return; }
            tts.setLanguage(Locale.SIMPLIFIED_CHINESE);
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String utteranceId) {
                    JSObject state = new JSObject();
                    state.put("active", true);
                    state.put("utteranceId", utteranceId);
                    notifyListeners("ttsStateChanged", state);
                }

                @Override public void onDone(String utteranceId) {
                    finishSpeaking(utteranceId, null);
                }

                @Override public void onError(String utteranceId) {
                    finishSpeaking(utteranceId, "tts_playback_failed");
                }

                @Override public void onError(String utteranceId, int errorCode) {
                    finishSpeaking(utteranceId, "tts_playback_failed_" + errorCode);
                }

                @Override public void onStop(String utteranceId, boolean interrupted) {
                    finishSpeaking(utteranceId, null);
                }
            });
            speakNow(call, text);
        });
    }

    private void speakNow(PluginCall call, String text) {
        String utteranceId = "yachiyo-" + System.nanoTime();
        pendingSpeakCalls.put(utteranceId, call);
        int result = tts.speak(text, TextToSpeech.QUEUE_ADD, null, utteranceId);
        if (result == TextToSpeech.ERROR) finishSpeaking(utteranceId, "tts_enqueue_failed");
    }

    private void finishSpeaking(String utteranceId, String error) {
        PluginCall pendingCall = pendingSpeakCalls.remove(utteranceId);
        if (pendingCall != null) {
            if (error == null) pendingCall.resolve();
            else pendingCall.reject(error);
        }
        JSObject state = new JSObject();
        state.put("active", false);
        state.put("utteranceId", utteranceId);
        notifyListeners("ttsStateChanged", state);
    }

    private void resolvePendingSpeech() {
        for (Map.Entry<String, PluginCall> entry : pendingSpeakCalls.entrySet()) {
            PluginCall pendingCall = pendingSpeakCalls.remove(entry.getKey());
            if (pendingCall != null) pendingCall.resolve();
        }
    }

    @PluginMethod public void stopSpeaking(PluginCall call) {
        if (tts != null) tts.stop();
        resolvePendingSpeech();
        JSObject state = new JSObject();
        state.put("active", false);
        notifyListeners("ttsStateChanged", state);
        call.resolve();
    }
    @Override protected void handleOnDestroy() {
        cancelActiveRecognition("语音识别已停止。", "speech_recognition_cancelled");
        resolvePendingSpeech();
        if (tts != null) { tts.stop(); tts.shutdown(); tts = null; }
    }
}
