package io.github.yachiyoclaw.media;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Handler;
import android.os.Looper;
import androidx.core.content.ContextCompat;
import com.k2fsa.sherpa.onnx.OnlineModelConfig;
import com.k2fsa.sherpa.onnx.OnlineRecognizer;
import com.k2fsa.sherpa.onnx.OnlineRecognizerConfig;
import com.k2fsa.sherpa.onnx.OnlineStream;
import com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig;
import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Owns the bundled streaming ASR runtime. Model output is returned only to the
 * active Capacitor call and never leaves the device. */
final class YachiyoOfflineAsrEngine {
    static final String MODEL_DIR = "asr/sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16";
    static final String ENCODER = MODEL_DIR + "/encoder-epoch-99-avg-1.int8.onnx";
    static final String DECODER = MODEL_DIR + "/decoder-epoch-99-avg-1.int8.onnx";
    static final String JOINER = MODEL_DIR + "/joiner-epoch-99-avg-1.int8.onnx";
    static final String TOKENS = MODEL_DIR + "/tokens.txt";

    private static final int SAMPLE_RATE = 16_000;
    private static final int CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO;
    private static final int AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT;

    interface Listener {
        void onState(String state);
        void onPartial(String text);
        void onComplete(String text);
        void onError(String message, String code);
    }

    final class Session {
        private final Listener listener;
        private final AtomicBoolean stopRequested = new AtomicBoolean();
        private final AtomicBoolean cancelled = new AtomicBoolean();
        private volatile AudioRecord audioRecord;

        private Session(Listener listener) {
            this.listener = listener;
        }

        void stop() {
            stopRequested.set(true);
        }

        void cancel() {
            cancelled.set(true);
            stopRequested.set(true);
            AudioRecord recorder = audioRecord;
            if (recorder != null) {
                try {
                    recorder.stop();
                } catch (IllegalStateException ignored) {
                    // The worker may already be closing the recorder.
                }
            }
        }
    }

    private final Context context;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Object recognizerLock = new Object();
    private volatile OnlineRecognizer recognizer;
    private volatile Session activeSession;

    YachiyoOfflineAsrEngine(Context context) {
        this.context = context.getApplicationContext();
    }

    boolean isBundledModelPresent() {
        return assetExists(ENCODER) && assetExists(DECODER) && assetExists(JOINER) && assetExists(TOKENS);
    }

    Session start(Listener listener) {
        Session previous = activeSession;
        if (previous != null) previous.cancel();
        Session session = new Session(listener);
        activeSession = session;
        executor.execute(() -> runSession(session));
        return session;
    }

    void close() {
        Session session = activeSession;
        if (session != null) session.cancel();
        executor.shutdownNow();
        synchronized (recognizerLock) {
            if (recognizer != null) {
                recognizer.release();
                recognizer = null;
            }
        }
    }

    private void runSession(Session session) {
        AudioRecord recorder = null;
        OnlineStream stream = null;
        try {
            postState(session, "starting");
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
                postError(session, "请授予麦克风权限后再使用语音输入。", "microphone_permission_denied");
                return;
            }
            if (!isBundledModelPresent()) {
                postError(session, "应用内置语音模型不完整，请重新安装应用。", "offline_asr_model_missing");
                return;
            }

            OnlineRecognizer runtime = getOrCreateRecognizer();
            int minimumBuffer = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_CONFIG, AUDIO_FORMAT);
            if (minimumBuffer <= 0) throw new IllegalStateException("offline_asr_invalid_audio_buffer");
            recorder = new AudioRecord(
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                SAMPLE_RATE,
                CHANNEL_CONFIG,
                AUDIO_FORMAT,
                Math.max(minimumBuffer * 2, SAMPLE_RATE / 2)
            );
            if (recorder.getState() != AudioRecord.STATE_INITIALIZED) {
                throw new IllegalStateException("offline_asr_audio_initialization_failed");
            }
            session.audioRecord = recorder;
            stream = runtime.createStream("");
            recorder.startRecording();
            postState(session, "listening");

            short[] buffer = new short[SAMPLE_RATE / 10];
            String committed = "";
            String latest = "";
            boolean speechStarted = false;
            while (!session.stopRequested.get()) {
                int count = recorder.read(buffer, 0, buffer.length);
                if (count == AudioRecord.ERROR_INVALID_OPERATION || count == AudioRecord.ERROR_BAD_VALUE) {
                    throw new IllegalStateException("offline_asr_audio_read_failed");
                }
                if (count <= 0) continue;
                float[] samples = new float[count];
                float peak = 0f;
                for (int index = 0; index < count; index++) {
                    samples[index] = buffer[index] / 32768.0f;
                    peak = Math.max(peak, Math.abs(samples[index]));
                }
                if (!speechStarted && peak > 0.015f) {
                    speechStarted = true;
                    postState(session, "speech");
                }
                stream.acceptWaveform(samples, SAMPLE_RATE);
                while (runtime.isReady(stream)) runtime.decode(stream);

                String current = runtime.getResult(stream).getText().trim();
                String combined = combineTranscript(committed, current);
                if (!combined.isEmpty() && !combined.equals(latest)) {
                    latest = combined;
                    postPartial(session, latest);
                }
                if (runtime.isEndpoint(stream)) {
                    committed = combined;
                    runtime.reset(stream);
                }
            }

            postState(session, "processing");
            float[] tailPadding = new float[SAMPLE_RATE / 2];
            stream.acceptWaveform(tailPadding, SAMPLE_RATE);
            while (runtime.isReady(stream)) runtime.decode(stream);
            String finalText = combineTranscript(committed, runtime.getResult(stream).getText().trim());
            if (finalText.isEmpty()) finalText = latest;
            postComplete(session, finalText);
        } catch (Throwable error) {
            if (!session.cancelled.get()) {
                String code = error instanceof UnsatisfiedLinkError
                    ? "offline_asr_runtime_unavailable"
                    : "offline_asr_failed";
                postError(session, "应用内置语音识别启动失败，请重试。", code);
            }
        } finally {
            session.audioRecord = null;
            if (recorder != null) {
                try {
                    if (recorder.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) recorder.stop();
                } catch (IllegalStateException ignored) {
                    // Cancellation can stop it before this cleanup runs.
                }
                recorder.release();
            }
            if (stream != null) stream.release();
        }
    }

    private OnlineRecognizer getOrCreateRecognizer() {
        OnlineRecognizer current = recognizer;
        if (current != null) return current;
        synchronized (recognizerLock) {
            if (recognizer != null) return recognizer;
            OnlineTransducerModelConfig transducer = new OnlineTransducerModelConfig();
            transducer.setEncoder(ENCODER);
            transducer.setDecoder(DECODER);
            transducer.setJoiner(JOINER);

            OnlineModelConfig model = new OnlineModelConfig();
            model.setTransducer(transducer);
            model.setTokens(TOKENS);
            // This 2023 model predates Zipformer2 metadata such as
            // query_head_dims; declaring the newer architecture aborts JNI.
            model.setModelType(modelType());
            model.setNumThreads(Math.max(2, Math.min(4, Runtime.getRuntime().availableProcessors() / 2)));
            model.setDebug(false);

            OnlineRecognizerConfig config = new OnlineRecognizerConfig();
            config.setModelConfig(model);
            config.setEnableEndpoint(true);
            config.setDecodingMethod("greedy_search");
            recognizer = new OnlineRecognizer(context.getAssets(), config);
            return recognizer;
        }
    }

    static String combineTranscript(String committed, String current) {
        String left = committed == null ? "" : committed.trim();
        String right = current == null ? "" : current.trim();
        if (left.isEmpty()) return right;
        if (right.isEmpty()) return left;
        if (left.endsWith(right)) return left;
        if (right.startsWith(left)) return right;
        boolean latinBoundary = Character.isLetterOrDigit(left.charAt(left.length() - 1))
            && Character.isLetterOrDigit(right.charAt(0))
            && left.charAt(left.length() - 1) < 128
            && right.charAt(0) < 128;
        return left + (latinBoundary ? " " : "") + right;
    }

    static String modelType() {
        return "zipformer";
    }

    private boolean assetExists(String path) {
        String directory = path.substring(0, path.lastIndexOf('/'));
        String filename = path.substring(path.lastIndexOf('/') + 1);
        try {
            String[] children = context.getAssets().list(directory);
            if (children == null) return false;
            for (String child : children) if (filename.equals(child)) return true;
            return false;
        } catch (IOException ignored) {
            return false;
        }
    }

    private boolean isActive(Session session) {
        return activeSession == session && !session.cancelled.get();
    }

    private void postState(Session session, String state) {
        mainHandler.post(() -> {
            if (isActive(session)) session.listener.onState(state);
        });
    }

    private void postPartial(Session session, String text) {
        mainHandler.post(() -> {
            if (isActive(session)) session.listener.onPartial(text);
        });
    }

    private void postComplete(Session session, String text) {
        mainHandler.post(() -> {
            if (isActive(session)) {
                session.listener.onComplete(text);
                if (activeSession == session) activeSession = null;
            }
        });
    }

    private void postError(Session session, String message, String code) {
        mainHandler.post(() -> {
            if (isActive(session)) {
                session.listener.onError(message, code);
                if (activeSession == session) activeSession = null;
            }
        });
    }
}
