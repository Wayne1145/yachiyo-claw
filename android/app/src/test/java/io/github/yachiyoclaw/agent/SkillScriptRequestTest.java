package io.github.yachiyoclaw.agent;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class SkillScriptRequestTest {

    @Test
    public void shellQuotePreservesOneArgument() {
        assertEquals("'hello world'", SkillScriptRequest.shellQuote("hello world"));
        assertEquals("'one'\\''two'", SkillScriptRequest.shellQuote("one'two"));
        assertEquals("'$HOME; rm -rf /'", SkillScriptRequest.shellQuote("$HOME; rm -rf /"));
    }
}
