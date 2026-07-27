package io.github.yachiyoclaw.plugin;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import org.junit.Test;

public final class PinnedHttpsClientTest {
    @Test
    public void parsesABoundedContentLengthResponse() throws Exception {
        byte[] response = (
            "HTTP/1.1 200 OK\r\n" +
            "Content-Type: application/json\r\n" +
            "Content-Length: 2\r\n\r\n{}"
        ).getBytes(StandardCharsets.ISO_8859_1);

        PinnedHttpsClient.Response parsed = PinnedHttpsClient.readResponse(
            new ByteArrayInputStream(response),
            "GET",
            1024
        );

        assertEquals(200, parsed.status);
        assertEquals("application/json", parsed.header("Content-Type"));
        assertArrayEquals("{}".getBytes(StandardCharsets.ISO_8859_1), parsed.body);
        assertFalse(parsed.truncated);
    }

    @Test
    public void truncatesChunkedBodiesWithoutLosingParserBoundaries() throws Exception {
        byte[] response = (
            "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n" +
            "4\r\ntest\r\n3\r\ning\r\n0\r\n\r\n"
        ).getBytes(StandardCharsets.ISO_8859_1);

        PinnedHttpsClient.Response parsed = PinnedHttpsClient.readResponse(
            new ByteArrayInputStream(response),
            "GET",
            5
        );

        assertEquals("testi", new String(parsed.body, StandardCharsets.ISO_8859_1));
        assertTrue(parsed.truncated);
    }
}
