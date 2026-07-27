package io.github.yachiyoclaw.model;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.List;
import java.util.Set;
import org.junit.Test;

public final class LocalToolProtocolTest {
    @Test
    public void recognizesOnlyAllowlistedStructuredCalls() {
        String output = "Checking.<tool_call>{\"name\":\"device_info\",\"arguments\":{}}</tool_call>";
        List<LocalToolProtocol.ProtocolMatch> matches =
            LocalToolProtocol.findKnownCalls(output, Set.of("device_info"));

        assertEquals(1, matches.size());
        assertEquals("device_info", matches.get(0).name);
        assertEquals("Checking.", output.substring(0, matches.get(0).start));
    }

    @Test
    public void ignoresUnknownToolsAndCapsCallsPerTurn() {
        String unknown = "<tool_call>{\"name\":\"shell_anything\",\"arguments\":{}}</tool_call>";
        assertEquals(0, LocalToolProtocol.findKnownCalls(unknown, Set.of("device_info")).size());

        String known = "<tool_call>{\"name\":\"device_info\",\"arguments\":{}}</tool_call>";
        assertEquals(4, LocalToolProtocol.findKnownCalls(known.repeat(8), Set.of("device_info")).size());
    }

    @Test
    public void compactsLiteRtSystemInstructionsWithoutDroppingPriorityEdges() {
        String value = "IDENTITY:" + "a".repeat(4_000) + ":TOOL_POLICY";
        String compacted = LocalToolProtocol.compactLiteRtSystemInstruction(value);

        assertEquals(2_400, compacted.length());
        assertTrue(compacted.startsWith("IDENTITY:"));
        assertTrue(compacted.endsWith(":TOOL_POLICY"));
    }

    @Test
    public void compactsAgentBlocksWithoutBrokenTagsOrContradictorySandboxPolicy() {
        String value = "model metadata\n"
            + "<agent_soul>" + "s".repeat(1_000) + "</agent_soul>"
            + "<agent_operating_instructions>" + "a".repeat(1_000) + "</agent_operating_instructions>"
            + "<long_term_memory>" + "m".repeat(500) + "</long_term_memory>"
            + "<sandbox_status>The local Linux sandbox is unavailable.</sandbox_status>"
            + "<local_linux_sandbox>AVAILABLE " + "x".repeat(1_000) + "</local_linux_sandbox>"
            + "<skills_policy>" + "k".repeat(500) + "</skills_policy>"
            + "<phone_control>disabled</phone_control>";
        String compacted = LocalToolProtocol.compactLiteRtSystemInstruction(value);

        assertTrue(compacted.length() <= 2_400);
        assertTrue(compacted.contains("</agent_soul>"));
        assertTrue(compacted.contains("</agent_operating_instructions>"));
        assertTrue(compacted.contains("</sandbox_status>"));
        assertTrue(!compacted.contains("<local_linux_sandbox>"));
    }

}
