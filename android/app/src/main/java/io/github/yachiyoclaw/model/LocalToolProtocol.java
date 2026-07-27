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
import org.json.JSONTokener;
import org.json.JSONObject;

/** Converts model-authored structured calls into inert events; execution remains in the WebView Tool Broker. */
final class LocalToolProtocol {
    private static final Pattern TOOL_CALL = Pattern.compile("<tool_call>\\s*(\\{.*?\\})\\s*</tool_call>", Pattern.DOTALL);
    private static final Pattern TOOL_NAME = Pattern.compile("\"name\"\\s*:\\s*\"([A-Za-z0-9._:-]{1,120})\"");
    private static final Pattern FUNCTION_GEMMA_CALL = Pattern.compile(
        "<start_function_call>\\s*call:([A-Za-z0-9._:-]{1,120})\\{(.*?)\\}\\s*<end_function_call>",
        Pattern.DOTALL
    );
    private static final int MAX_TOOL_PROMPT_CHARS = 80_000;
    private static final int MAX_CALLS = 4;
    private static final int MAX_LITERT_SYSTEM_CHARS = 2_400;

    private LocalToolProtocol() {}

    /** Keeps both identity and late tool policy while fitting LiteRT models exported with a 2K context. */
    static String compactLiteRtSystemInstruction(String instruction) {
        if (instruction == null || instruction.length() <= MAX_LITERT_SYSTEM_CHARS) return instruction == null ? "" : instruction;
        String structured = compactStructuredSystemInstruction(instruction);
        if (!structured.isEmpty()) return structured;
        String marker = "\n...[system prompt compacted for 2K LiteRT context]...\n";
        int headLength = 800;
        int tailLength = MAX_LITERT_SYSTEM_CHARS - headLength - marker.length();
        return instruction.substring(0, headLength) + marker + instruction.substring(instruction.length() - tailLength);
    }

    private static String compactStructuredSystemInstruction(String instruction) {
        int firstTag = instruction.indexOf('<');
        if (firstTag < 0) return "";
        List<String> sections = new ArrayList<>();
        String prefix = instruction.substring(0, firstTag).trim();
        if (!prefix.isEmpty()) sections.add(prefix.substring(0, Math.min(prefix.length(), 160)));
        String soul = findTaggedBlock(instruction, "agent_soul");
        if (soul != null) sections.add(compactTaggedBlock("agent_soul", firstMeaningfulLine(soul), 220));
        if (findTaggedBlock(instruction, "agent_operating_instructions") != null) {
            sections.add("<agent_operating_instructions>\nUse provided tools for actionable work. Continue until complete or genuinely blocked. Never invent tool results.\n</agent_operating_instructions>");
        }
        if (findTaggedBlock(instruction, "long_term_memory") != null) {
            sections.add("<long_term_memory>\nSearch when prior facts may help. Save only durable, explicit, non-sensitive user facts.\n</long_term_memory>");
        }
        String sandboxStatus = findTaggedBlock(instruction, "sandbox_status");
        if (sandboxStatus != null) {
            sections.add(compactTaggedBlock("sandbox_status", firstMeaningfulLine(sandboxStatus), 180));
        } else if (findTaggedBlock(instruction, "local_linux_sandbox") != null) {
            sections.add("<local_linux_sandbox>\nA local Linux sandbox is available. Use its tools for files, commands, coding, and tests.\n</local_linux_sandbox>");
        }
        if (findTaggedBlock(instruction, "skills_policy") != null) {
            sections.add("<skills_policy>\nLoad an exact matching enabled Skill before using it; never invent Skills.\n</skills_policy>");
        }
        String phone = findTaggedBlock(instruction, "phone_control");
        if (phone != null) sections.add(compactTaggedBlock("phone_control", firstMeaningfulLine(phone), 220));
        if (sections.size() < 2) return "";
        String result = String.join("\n\n", sections);
        return result.length() <= MAX_LITERT_SYSTEM_CHARS ? result : result.substring(0, MAX_LITERT_SYSTEM_CHARS);
    }

    private static String firstMeaningfulLine(String body) {
        for (String line : body.split("\\R")) {
            String trimmed = line.trim();
            if (!trimmed.isEmpty()) return trimmed;
        }
        return "";
    }

    private static String findTaggedBlock(String instruction, String tag) {
        String open = "<" + tag + ">";
        String close = "</" + tag + ">";
        int start = instruction.indexOf(open);
        if (start < 0) return null;
        int bodyStart = start + open.length();
        int end = instruction.indexOf(close, bodyStart);
        return end < 0 ? null : instruction.substring(bodyStart, end).trim();
    }

    private static String compactTaggedBlock(String tag, String body, int maxChars) {
        String open = "<" + tag + ">\n";
        String close = "\n</" + tag + ">";
        int bodyLimit = Math.max(0, maxChars - open.length() - close.length() - 3);
        String compactBody = body.length() <= bodyLimit ? body : body.substring(0, bodyLimit).trim() + "...";
        return open + compactBody + close;
    }

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
        // Keep the final user turn last. LiteRT-LM treats only that position as the active prompt.
        JSONArray ordered = new JSONArray().put(new JSONObject().put("role", "system").put("content", instruction));
        for (int index = 0; index < prepared.length(); index++) ordered.put(prepared.get(index));
        return ordered;
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
            JSArray functionGemma = parseFunctionGemmaEvents(output, allowedTools, requestId);
            if (functionGemma.length() > 0) return functionGemma;
        }
        if (calls == 0) {
            events.put(textEvent(output));
        } else if (cursor < output.length()) {
            events.put(textEvent(output.substring(cursor)));
        }
        return events;
    }

    private static JSArray parseFunctionGemmaEvents(String output, Set<String> allowedTools, String requestId) {
        JSArray events = new JSArray();
        Matcher matcher = FUNCTION_GEMMA_CALL.matcher(output);
        int cursor = 0;
        int calls = 0;
        while (matcher.find() && calls < MAX_CALLS) {
            String name = matcher.group(1);
            if (!allowedTools.contains(name)) continue;
            JSONObject arguments = parseFunctionGemmaArguments(matcher.group(2));
            if (arguments == null) continue;
            if (matcher.start() > cursor) events.put(textEvent(output.substring(cursor, matcher.start())));
            events.put(new JSObject()
                .put("type", "tool-call")
                .put("name", name)
                .put("arguments", arguments)
                .put("callId", boundedRequestId(requestId) + "-tool-" + (calls + 1)));
            cursor = matcher.end();
            calls++;
        }
        if (calls > 0 && cursor < output.length()) events.put(textEvent(output.substring(cursor)));
        return events;
    }

    /** Parses FunctionGemma's comma-separated key:value payload without executing malformed output. */
    static JSONObject parseFunctionGemmaArguments(String input) {
        JSONObject result = new JSONObject();
        String value = input == null ? "" : input.trim();
        int cursor = 0;
        try {
            while (cursor < value.length()) {
                while (cursor < value.length() && (value.charAt(cursor) == ',' || Character.isWhitespace(value.charAt(cursor)))) cursor++;
                if (cursor >= value.length()) break;
                int colon = value.indexOf(':', cursor);
                if (colon < 0) return null;
                String key = value.substring(cursor, colon).trim();
                if (!key.matches("[A-Za-z0-9._-]{1,120}")) return null;
                cursor = colon + 1;
                while (cursor < value.length() && Character.isWhitespace(value.charAt(cursor))) cursor++;
                Object parsed;
                if (value.startsWith("<escape>", cursor)) {
                    cursor += "<escape>".length();
                    int end = value.indexOf("<escape>", cursor);
                    if (end < 0) return null;
                    parsed = value.substring(cursor, end);
                    cursor = end + "<escape>".length();
                } else {
                    int comma = value.indexOf(',', cursor);
                    int end = comma < 0 ? value.length() : comma;
                    String raw = value.substring(cursor, end).trim();
                    if (raw.isEmpty()) return null;
                    parsed = new JSONTokener(raw).nextValue();
                    cursor = end;
                }
                result.put(key, parsed);
                while (cursor < value.length() && Character.isWhitespace(value.charAt(cursor))) cursor++;
                if (cursor < value.length() && value.charAt(cursor) != ',') return null;
            }
            return result;
        } catch (Exception ignored) {
            return null;
        }
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
