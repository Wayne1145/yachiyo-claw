package io.github.yachiyoclaw.workspace;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import org.junit.Test;

public class ControlledBrowserScriptsTest {
    @Test public void modelValuesAreQuotedAndRefsUseDedicatedAttributes() {
        String click = ControlledBrowserScripts.click("e1\";alert(1)//", null);
        assertTrue(click.contains("CSS.escape"));
        assertTrue(click.contains("data-yachiyo-agent-ref"));
        assertFalse(click.contains("CSS.escape(e1"));
    }

    @Test public void semanticSnapshotIsBoundedAndDoesNotExposeFullHtml() {
        String snapshot = ControlledBrowserScripts.snapshotExpression();
        assertTrue(snapshot.contains("slice(0,250)"));
        assertTrue(snapshot.contains("slice(0,50000)"));
        assertFalse(snapshot.contains("outerHTML"));
    }

    @Test public void javascriptStringsEscapeMarkupAndLineSeparators() {
        String quoted = ControlledBrowserScripts.quote("x\"\\\n</script>\u2028");
        assertTrue(quoted.startsWith("\"") && quoted.endsWith("\""));
        assertTrue(quoted.contains("\\\"") && quoted.contains("\\\\") && quoted.contains("\\n"));
        assertTrue(quoted.contains("\\u2028"));
    }
}
