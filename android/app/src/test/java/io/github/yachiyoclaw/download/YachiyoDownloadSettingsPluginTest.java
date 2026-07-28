package io.github.yachiyoclaw.download;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class YachiyoDownloadSettingsPluginTest {
    @Test
    public void parsesCloudflareCountryWithoutAcceptingArbitraryValues() {
        assertEquals("CN", YachiyoDownloadSettingsPlugin.parseTraceCountry("fl=1\nloc=cn\ntls=TLSv1.3\n"));
        assertEquals("US", YachiyoDownloadSettingsPlugin.parseTraceCountry("loc=US\n"));
        assertEquals("", YachiyoDownloadSettingsPlugin.parseTraceCountry("loc=CHN\n"));
        assertEquals("", YachiyoDownloadSettingsPlugin.parseTraceCountry("ip=127.0.0.1\n"));
    }
}
