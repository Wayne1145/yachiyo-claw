package io.github.yachiyoclaw.scheduler;

import static org.junit.Assert.assertEquals;
import org.junit.Test;

public final class HeadlessAgentRuntimeTest {
    @Test public void normalizesOpenAiCompatibleChatCompletionEndpoint() throws Exception {
        assertEquals(
            "https://api.example.com/v1/chat/completions",
            HeadlessAgentRuntime.endpoint("https://api.example.com/v1/").toString()
        );
        assertEquals(
            "https://api.example.com/v1/chat/completions",
            HeadlessAgentRuntime.endpoint("https://api.example.com/v1/chat/completions").toString()
        );
    }

    @Test public void sanitizesToolFailuresBeforeReturningThemToTheModel() {
        assertEquals("headless_tool_failed", HeadlessAgentRuntime.safeToolError(new Exception()));
        assertEquals("bad path", HeadlessAgentRuntime.safeToolError(new Exception("bad\0path")));
    }
}
