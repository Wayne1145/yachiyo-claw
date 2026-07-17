package io.github.yachiyoclaw.agent;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class YachiyoAgentPluginTest {

    @Test
    public void resolvesPrimaryStorageDirectory() {
        assertEquals(
            "/storage/emulated/0/Yachiyo Claw/projects",
            YachiyoAgentPlugin.resolveDocumentIdToPath("primary:Yachiyo Claw/projects")
        );
    }

    @Test
    public void resolvesRemovableStorageDirectory() {
        assertEquals(
            "/storage/1234-ABCD/agents",
            YachiyoAgentPlugin.resolveDocumentIdToPath("1234-ABCD:agents")
        );
    }

    @Test
    public void rejectsTraversalAndUnsupportedIds() {
        assertNull(YachiyoAgentPlugin.resolveDocumentIdToPath("primary:projects/../private"));
        assertNull(YachiyoAgentPlugin.resolveDocumentIdToPath("downloads"));
    }
}
