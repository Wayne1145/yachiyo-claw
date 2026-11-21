package io.github.yachiyoclaw.media;

import android.Manifest;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.AudioTrack;
import android.media.MediaRecorder;
import android.media.audiofx.AcousticEchoCanceler;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.Arrays;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import org.json.JSONObject;

/** Authenticated WSS + native PCM. Long-lived keys are never put in a URL or WebView subprotocol. */
@CapacitorPlugin(name = "YachiyoRealtime", permissions = @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }))
public final class YachiyoRealtimePlugin extends Plugin {
    private final OkHttpClient client = new OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(0, TimeUnit.MILLISECONDS).pingInterval(20, TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).build();
    private final ExecutorService playback = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final AtomicInteger queuedAudio = new AtomicInteger();
    private volatile WebSocket socket;
    private volatile AudioRecord recorder;
    private volatile AudioTrack track;
    private volatile boolean listening;
    private volatile boolean muted;
    private volatile boolean microphoneMuted;
    private volatile int generation;
    private volatile int playbackGeneration;
    private volatile String connectionId = "";
    private PluginCall pendingConnect;
    private int inputRate = 24000;
    private int outputRate = 24000;
    private volatile long framesWritten;
    private volatile boolean playbackSpeaking;
    private volatile String audioItem = "";
    private volatile long itemStartFrames;
    private AcousticEchoCanceler echo;
    private AudioManager audioManager;
    private int previousAudioMode;
    private boolean previousSpeakerphone;

    @PluginMethod public void connect(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) { requestPermissionForAlias("microphone", call, "permissionResult"); return; }
        connectAuthorized(call);
    }

    @PermissionCallback private void permissionResult(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) call.reject("realtime_microphone_permission_denied");
        else connectAuthorized(call);
    }

    private synchronized void connectAuthorized(PluginCall call) {
        String endpoint = call.getString("endpoint", "");
        String key = call.getString("apiKey", "");
        String id = call.getString("connectionId", "");
        JSObject update = call.getObject("sessionUpdate");
        try {
            java.net.URI uri = new java.net.URI(endpoint);
            if (!"wss".equals(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null || uri.getFragment() != null || key.isBlank() || id.isBlank() || update == null) { call.reject("realtime_configuration_invalid"); return; }
        } catch (Exception error) { call.reject("realtime_configuration_invalid"); return; }
        disconnectInternal();
        connectionId = id;
        inputRate = call.getInt("inputRate", 24000);
        outputRate = call.getInt("outputRate", 24000);
        if ((inputRate != 16000 && inputRate != 24000) || outputRate != 24000) { call.reject("realtime_sample_rate_unsupported"); return; }
        int active = generation;
        pendingConnect = call;
        Request.Builder request = new Request.Builder().url(endpoint).header("Authorization", "Bearer " + key);
        if (call.getBoolean("betaHeader", false)) request.header("OpenAI-Beta", "realtime=v1");
        muted = call.getBoolean("muted", false);
        microphoneMuted = call.getBoolean("microphoneMuted", false);
        socket = client.newWebSocket(request.build(), new WebSocketListener() {
            private boolean opened;
            @Override public void onOpen(WebSocket ws, Response response) {
                if (active != generation) { ws.cancel(); return; }
                opened = true;
                pendingConnect = null;
                ws.send(update.toString());
                call.resolve(new JSObject().put("connected", true));
            }
            @Override public void onMessage(WebSocket ws, String text) {
                if (active != generation) return;
                try {
                    if (text.length() > 2 * 1024 * 1024) throw new IllegalStateException("event_too_large");
                    JSONObject event = new JSONObject(text);
                    String type = event.optString("type");
                    if ("response.audio.delta".equals(type) || "response.output_audio.delta".equals(type)) {
                        String item = event.optString("item_id");
                        if (!item.equals(audioItem)) { audioItem = item; itemStartFrames = framesWritten; }
                        playAudio(event.optString("delta"), active);
                        return;
                    }
                    if ("input_audio_buffer.speech_started".equals(type)) {
                        AudioTrack output = track;
                        if (output != null && !audioItem.isEmpty()) {
                            long heard = Integer.toUnsignedLong(output.getPlaybackHeadPosition());
                            if (heard < framesWritten) ws.send(new JSONObject().put("type", "conversation.item.truncate").put("item_id", audioItem).put("content_index", 0).put("audio_end_ms", Math.max(0, heard - itemStartFrames) * 1000 / outputRate).toString());
                        }
                        interruptPlayback();
                    }
                    notifyListeners("realtimeEvent", new JSObject().put("connectionId", id).put("event", new JSObject(text)));
                } catch (Exception error) { emitState("error", "realtime_event_invalid"); }
            }
            @Override public void onFailure(WebSocket ws, Throwable error, Response response) {
                if (active != generation) return;
                String message = "realtime_connection_failed" + (response == null ? "" : ": HTTP " + response.code());
                if (!opened) { pendingConnect = null; call.reject(message); }
                emitState("error", message);
                disconnectInternal();
            }
            @Override public void onClosed(WebSocket ws, int code, String reason) {
                if (active != generation) return;
                emitState("disconnected", "");
                disconnectInternal();
            }
        });
    }

    @PluginMethod public synchronized void startMicrophone(PluginCall call) {
        if (!matches(call) || socket == null) { call.reject("realtime_not_connected"); return; }
        if (listening) { call.resolve(); return; }
        if (getPermissionState("microphone") != PermissionState.GRANTED) { call.reject("realtime_microphone_permission_denied"); return; }
        try {
            int minimum = AudioRecord.getMinBufferSize(inputRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            if (minimum <= 0) throw new IllegalStateException();
            recorder = new AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, inputRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(minimum * 2, inputRate / 5));
            if (recorder.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException();
            audioManager = (AudioManager) getContext().getSystemService(android.content.Context.AUDIO_SERVICE);
            previousAudioMode = audioManager.getMode();
            previousSpeakerphone = audioManager.isSpeakerphoneOn();
            audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
            boolean headset = false;
            for (android.media.AudioDeviceInfo device : audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
                int type = device.getType();
                if (type == android.media.AudioDeviceInfo.TYPE_WIRED_HEADPHONES || type == android.media.AudioDeviceInfo.TYPE_WIRED_HEADSET || type == android.media.AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || type == android.media.AudioDeviceInfo.TYPE_BLUETOOTH_SCO || type == android.media.AudioDeviceInfo.TYPE_USB_HEADSET) headset = true;
            }
            if (!headset) audioManager.setSpeakerphoneOn(true);
            if (AcousticEchoCanceler.isAvailable()) { echo = AcousticEchoCanceler.create(recorder.getAudioSessionId()); if (echo != null) echo.setEnabled(true); }
            recorder.startRecording();
            listening = true;
            int active = generation;
            AudioRecord owned = recorder;
            new Thread(() -> {
                byte[] buffer = new byte[inputRate / 25]; // 20 ms mono PCM16.
                long lastLevelAt = 0;
                try {
                    while (listening && active == generation) {
                        int n = owned.read(buffer, 0, buffer.length);
                        if (n <= 0) throw new IllegalStateException();
                        // Muting never uploads captured samples. Keep silence flowing so server VAD can finish a turn.
                        if (microphoneMuted) Arrays.fill(buffer, 0, n, (byte) 0);
                        long now = android.os.SystemClock.elapsedRealtime();
                        if (now - lastLevelAt >= 100) {
                            double squares = 0;
                            for (int i = 0; i + 1 < n; i += 2) {
                                double sample = (short) ((buffer[i] & 255) | (buffer[i + 1] << 8)) / 32768.0;
                                squares += sample * sample;
                            }
                            double rms = Math.sqrt(squares / Math.max(1, n / 2));
                            double level = microphoneMuted ? 0 : Math.max(0, Math.min(1, (20 * Math.log10(Math.max(rms, 0.000001)) + 60) / 60));
                            notifyListeners("realtimeLevel", new JSObject().put("connectionId", connectionId).put("level", level));
                            lastLevelAt = now;
                        }
                        WebSocket ws = socket;
                        if (ws == null || ws.queueSize() > 1024 * 1024) throw new IllegalStateException();
                        ws.send(new JSONObject().put("type", "input_audio_buffer.append").put("audio", Base64.encodeToString(Arrays.copyOf(buffer, n), Base64.NO_WRAP)).toString());
                    }
                } catch (Exception error) {
                    if (active == generation) { emitState("error", "realtime_audio_input_failed"); disconnectInternal(); }
                }
            }, "yachiyo-realtime-mic").start();
            call.resolve();
        } catch (RuntimeException error) { disconnectInternal(); call.reject("realtime_microphone_unavailable"); }
    }

    @PluginMethod public void sendEvent(PluginCall call) {
        JSObject event = call.getObject("event");
        WebSocket ws = socket;
        if (!matches(call) || ws == null || ws.queueSize() > 2 * 1024 * 1024 || event == null || event.toString().length() > 2 * 1024 * 1024 || !ws.send(event.toString())) { call.reject("realtime_send_failed"); return; }
        call.resolve();
    }

    @PluginMethod public void setMuted(PluginCall call) { if (matches(call)) { muted = call.getBoolean("muted", false); if (muted) interruptPlayback(); } call.resolve(); }
    @PluginMethod public void setMicrophoneMuted(PluginCall call) {
        if (matches(call)) {
            microphoneMuted = call.getBoolean("muted", false);
            if (microphoneMuted) {
                WebSocket ws = socket;
                if (ws != null) ws.send("{\"type\":\"input_audio_buffer.clear\"}");
                notifyListeners("realtimeLevel", new JSObject().put("connectionId", connectionId).put("level", 0));
            }
        }
        call.resolve();
    }
    @PluginMethod public void disconnect(PluginCall call) { if (matches(call)) disconnectInternal(); call.resolve(); }
    @PluginMethod public void interrupt(PluginCall call) { if (matches(call)) interruptPlayback(); call.resolve(); }
    private boolean matches(PluginCall call) { return connectionId.equals(call.getString("connectionId", "")); }

    private void playAudio(String encoded, int active) {
        if (muted || encoded.isEmpty()) return;
        byte[] pcm = Base64.decode(encoded, Base64.DEFAULT);
        if (pcm.length % 2 != 0) { emitState("error", "realtime_audio_format_invalid"); return; }
        if (queuedAudio.addAndGet(pcm.length) > 1024 * 1024) { queuedAudio.addAndGet(-pcm.length); emitState("error", "realtime_audio_buffer_full"); disconnectInternal(); return; }
        int epoch = playbackGeneration;
        playback.execute(() -> {
            try {
                if (muted || active != generation || epoch != playbackGeneration) return;
                if (track == null) {
                    int size = Math.max(AudioTrack.getMinBufferSize(outputRate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT), outputRate / 2);
                    track = new AudioTrack.Builder().setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()).setAudioFormat(new AudioFormat.Builder().setSampleRate(outputRate).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build()).setBufferSizeInBytes(size).setTransferMode(AudioTrack.MODE_STREAM).build();
                    framesWritten = 0;
                    track.play();
                }
                int offset = 0;
                while (offset < pcm.length && active == generation && epoch == playbackGeneration) {
                    int written = track.write(pcm, offset, pcm.length - offset, AudioTrack.WRITE_BLOCKING);
                    if (written <= 0) throw new IllegalStateException();
                    offset += written;
                    framesWritten += written / 2;
                    if (!playbackSpeaking) { playbackSpeaking = true; emitState("speaking", ""); }
                }
                pollPlaybackEnd(active, epoch, framesWritten);
            } catch (RuntimeException error) { if (active == generation) emitState("error", "realtime_audio_output_failed"); }
            finally { queuedAudio.addAndGet(-pcm.length); }
        });
    }

    private void pollPlaybackEnd(int active, int epoch, long target) {
        main.postDelayed(() -> {
            AudioTrack current = track;
            if (active != generation || epoch != playbackGeneration || current == null || target != framesWritten) return;
            try {
                if (Integer.toUnsignedLong(current.getPlaybackHeadPosition()) >= target) { playbackSpeaking = false; emitState("silent", ""); }
                else pollPlaybackEnd(active, epoch, target);
            } catch (RuntimeException ignored) { /* Track was released during interruption. */ }
        }, 60);
    }

    private void interruptPlayback() {
        playbackGeneration++;
        String interruptedConnection = connectionId;
        playback.execute(() -> {
            AudioTrack previous = track;
            track = null;
            if (previous != null) { try { previous.pause(); previous.flush(); previous.release(); } catch (RuntimeException ignored) {} }
            playbackSpeaking = false;
            framesWritten = 0;
            audioItem = "";
            notifyListeners("realtimeState", new JSObject().put("connectionId", interruptedConnection).put("state", "silent"));
        });
    }

    private void emitState(String state, String error) { notifyListeners("realtimeState", new JSObject().put("connectionId", connectionId).put("state", state).put("error", error)); }

    private synchronized void disconnectInternal() {
        generation++;
        if (pendingConnect != null) { pendingConnect.reject("realtime_call_cancelled"); pendingConnect = null; }
        listening = false;
        WebSocket previous = socket;
        socket = null;
        if (previous != null) { previous.close(1000, "Client ended call"); previous.cancel(); }
        AudioRecord mic = recorder;
        recorder = null;
        if (mic != null) { try { mic.stop(); mic.release(); } catch (RuntimeException ignored) {} }
        if (echo != null) { echo.release(); echo = null; }
        if (audioManager != null) { audioManager.setSpeakerphoneOn(previousSpeakerphone); audioManager.setMode(previousAudioMode); audioManager = null; }
        interruptPlayback();
    }

    @Override protected void handleOnPause() { emitState("disconnected", ""); disconnectInternal(); super.handleOnPause(); }
    @Override protected void handleOnDestroy() { disconnectInternal(); client.dispatcher().executorService().shutdown(); super.handleOnDestroy(); }
}
