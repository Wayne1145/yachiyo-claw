package io.github.yachiyoclaw.media;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
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
    private SpeechRecognizer recognizer;
    private TextToSpeech tts;
    private PluginCall pendingListenCall;
    private final Map<String, PluginCall> pendingSpeakCalls = new ConcurrentHashMap<>();

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
        else call.reject("microphone_permission_denied");
    }

    private void beginListening(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            stopRecognizer();
            pendingListenCall = call;
            recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
            recognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle params) {}
                @Override public void onBeginningOfSpeech() {}
                @Override public void onRmsChanged(float rmsdB) {}
                @Override public void onBufferReceived(byte[] buffer) {}
                @Override public void onEndOfSpeech() {}
                @Override public void onPartialResults(Bundle partialResults) {}
                @Override public void onEvent(int eventType, Bundle params) {}
                @Override public void onError(int error) {
                    if (pendingListenCall != null) pendingListenCall.reject("speech_recognition_error_" + error);
                    pendingListenCall = null;
                    stopRecognizer();
                }
                @Override public void onResults(Bundle results) {
                    ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    JSObject value = new JSObject();
                    value.put("text", matches == null || matches.isEmpty() ? "" : matches.get(0));
                    if (pendingListenCall != null) pendingListenCall.resolve(value);
                    pendingListenCall = null;
                    stopRecognizer();
                }
            });
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, call.getString("language", "zh-CN"));
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
            recognizer.startListening(intent);
        });
    }

    @PluginMethod public void stopListening(PluginCall call) {
        getActivity().runOnUiThread(() -> { if (recognizer != null) recognizer.stopListening(); call.resolve(); });
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
    private void stopRecognizer() { if (recognizer != null) { recognizer.destroy(); recognizer = null; } }
    @Override protected void handleOnDestroy() {
        stopRecognizer();
        resolvePendingSpeech();
        if (tts != null) { tts.stop(); tts.shutdown(); tts = null; }
    }
}
