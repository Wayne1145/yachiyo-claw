package io.github.yachiyoclaw.model;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import com.getcapacitor.JSArray;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class LocalToolProtocolInstrumentedTest {
    @Test
    public void loadsAndPreservesMessagesWithoutTools() throws Exception {
        JSONArray messages = new JSONArray().put(new JSONObject().put("role", "user").put("content", "hello"));
        JSONArray prepared = LocalToolProtocol.prepareMessages(messages, new JSONObject());
        assertEquals(messages.toString(), prepared.toString());
    }

    @Test
    public void keepsTheActiveUserPromptAfterTheInjectedToolInstruction() throws Exception {
        JSONArray messages = new JSONArray().put(new JSONObject().put("role", "user").put("content", "use the clock"));
        JSONObject tools = new JSONObject().put("get_time", new JSONObject().put("description", "clock"));
        JSONArray prepared = LocalToolProtocol.prepareMessages(messages, tools);

        assertEquals("system", prepared.getJSONObject(0).getString("role"));
        assertEquals("user", prepared.getJSONObject(prepared.length() - 1).getString("role"));
    }

    @Test
    public void parsesAllowlistedFunctionGemmaCallsIntoInertEvents() throws Exception {
        String output = "Calling.<start_function_call>call:get_weather{city:<escape>Tokyo<escape>,days:2}<end_function_call>";
        JSONObject tools = new JSONObject().put("get_weather", new JSONObject());
        JSArray events = LocalToolProtocol.parseEvents(output, tools, "request");

        assertEquals(2, events.length());
        assertEquals("tool-call", events.getJSONObject(1).getString("type"));
        assertEquals("get_weather", events.getJSONObject(1).getString("name"));
        assertEquals("Tokyo", events.getJSONObject(1).getJSONObject("arguments").getString("city"));
        assertEquals(2, events.getJSONObject(1).getJSONObject("arguments").getInt("days"));
        assertNull(LocalToolProtocol.parseFunctionGemmaArguments("broken"));
    }
}
