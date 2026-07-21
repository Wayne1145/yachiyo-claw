package io.github.yachiyoclaw.media;

import static org.junit.Assert.assertEquals;

import android.speech.SpeechRecognizer;
import org.junit.Test;

public class YachiyoVoicePluginTest {
    @Test
    public void mapsClientErrorToStableCodeAndActionableMessage() {
        assertEquals("speech_client_error", YachiyoVoicePlugin.speechErrorCode(SpeechRecognizer.ERROR_CLIENT));
        assertEquals("语音识别被系统中断，请重试。", YachiyoVoicePlugin.speechErrorMessage(SpeechRecognizer.ERROR_CLIENT));
    }

    @Test
    public void mapsMissingLanguageModel() {
        assertEquals("speech_language_unavailable", YachiyoVoicePlugin.speechErrorCode(13));
        assertEquals("所选语言的离线识别模型尚未下载。", YachiyoVoicePlugin.speechErrorMessage(13));
    }
}
