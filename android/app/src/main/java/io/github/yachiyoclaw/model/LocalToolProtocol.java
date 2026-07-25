package io.github.yachiyoclaw.model;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/** Converts model-authored structured calls into inert events; execution remains in the WebView Tool Broker. */
final class LocalToolProtocol {
    private static final Pattern TOOL_CALL = Pattern.compile("<tool_call>\\s*(\\{.*?})\\s*</tool_call>", Pattern.DOTALL);
    private static final Pattern TOOL_NAME = Pattern.compile("\"name\"\\s*:\\s*\"([A-Za-z0-9._:-]{1,120})\"");
    private static final int MAX_TOOL_PROMPT_CHARS = 80_000;
    private static final int MAX_CALLS = 4;

    private LocalToolProtocol() {}

    static JSONArray prepareMessages(JSONArray messages, JSONObject tools) throws Exception {
        JSONArray prepared = new JSONArray(messages.toString());
        if (tools == null || tools.length() == 0) return prepared;
        StringBuilder definitions = new StringBuilder();
        Iterator<String> names = tools.keys();
        while (names.hasNext() && definitions.length() < MAX_TOOL_PROMPT_CHARS) {
            String name = names.next();
            JSONObject definition = tools.optJSONObject(name);
            if (definition == null) continue;
            definitions.append("\n- ").append(name);
            String description = definition.optString("description");
            if (!description.isBlank()) definitions.append(": ").append(description);
            definitions.append("\n  input_schema: ").append(definition.opt("inputSchema"));
        }
        String instruction =
            "You have local tools. When a tool is needed, stop your answer and emit exactly one call in this form: " +
            "<tool_call>{\"name\":\"tool_name\",\"arguments\":{}}</tool_call>. " +
            "Do not wrap it in Markdown. Use only a listed tool and arguments matching its schema. " +
            "After the app returns a tool result, continue the task and call another tool if needed. Available tools:" +
            definitions.substring(0, Math.min(definitions.length(), MAX_TOOL_PROMPT_CHARS));
        prepared.put(new JSONObject().put("role", "system").put("content", instruction));
        return prepared;
    }

    static JSArray parseEvents(String output, JSONObject tools, String requestId) {
        JSArray events = new JSArray();
        if (output == null || output.isEmpty() || tools == null || tools.length() == 0) {
            if (output != null && !output.isEmpty()) events.put(textEvent(output));
            return events;
        }

        Set<String> allowedTools = new HashSet<>();
        Iterator<String> names = tools.keys();
        while (names.hasNext()) allowedTools.add(names.next());
        int cursor = 0;
        int calls = 0;
        for (ProtocolMatch match : findKnownCalls(output, allowedTools)) {
            JSONObject call;
            try {
                call = new JSONObject(match.payload);
            } catch (Exception ignored) {
                continue;
            }
            String name = call.optString("name");
            if (match.start > cursor) events.put(textEvent(output.substring(cursor, match.start)));
            Object arguments = call.opt("arguments");
            if (arguments == null || arguments == JSONObject.NULL) arguments = new JSONObject();
            String proposedId = call.optString("call_id");
            String callId = proposedId.matches("[A-Za-z0-9._:-]{1,128}")
                ? proposedId
                : boundedRequestId(requestId) + "-tool-" + (calls + 1);
            events.put(new JSObject()
                .put("type", "tool-call")
                .put("name", name)
                .put("arguments", arguments)
                .put("callId", callId));
            cursor = match.end;
            calls++;
        }
        if (calls == 0) {
            events.put(textEvent(output));
        } else if (cursor < output.length()) {
            events.put(textEvent(output.substring(cursor)));
        }
        return events;
    }

    static List<ProtocolMatch> findKnownCalls(String output, Set<String> allowedTools) {
        List<ProtocolMatch> result = new ArrayList<>();
        if (output == null || output.isEmpty() || allowedTools == null || allowedTools.isEmpty()) return result;
        Matcher matcher = TOOL_CALL.matcher(output);
        while (matcher.find() && result.size() < MAX_CALLS) {
            String payload = matcher.group(1);
            Matcher name = TOOL_NAME.matcher(payload);
            if (!name.find() || !allowedTools.contains(name.group(1))) continue;
            result.add(new ProtocolMatch(matcher.start(), matcher.end(), payload, name.group(1)));
        }
        return result;
    }

    static final class ProtocolMatch {
        final int start;
        final int end;
        final String payload;
        final String name;

        ProtocolMatch(int start, int end, String payload, String name) {
            this.start = start;
            this.end = end;
            this.payload = payload;
            this.name = name;
        }
    }

    private static JSObject textEvent(String text) {
        return new JSObject().put("type", "text").put("text", text);
    }

    private static String boundedRequestId(String requestId) {
        if (requestId != null && requestId.matches("[A-Za-z0-9._:-]{1,100}")) return requestId;
        return "local";
    }
}
