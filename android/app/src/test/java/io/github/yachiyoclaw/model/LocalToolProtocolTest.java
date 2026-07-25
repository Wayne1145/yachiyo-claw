package io.github.yachiyoclaw.model;

import static org.junit.Assert.assertEquals;

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
}
