package io.github.yachiyoclaw.media;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class YachiyoOfflineAsrEngineTest {
    @Test
    public void combinesChineseSegmentsWithoutArtificialSpaces() {
        assertEquals("八千代你好", YachiyoOfflineAsrEngine.combineTranscript("八千代", "你好"));
    }

    @Test
    public void separatesLatinSegmentsAndAvoidsDuplicates() {
        assertEquals("hello world", YachiyoOfflineAsrEngine.combineTranscript("hello", "world"));
        assertEquals("hello", YachiyoOfflineAsrEngine.combineTranscript("hello", "hello"));
    }

    @Test
    public void usesTheArchitectureDeclaredByTheBundled2023Model() {
        assertEquals("zipformer", YachiyoOfflineAsrEngine.modelType());
    }
}
