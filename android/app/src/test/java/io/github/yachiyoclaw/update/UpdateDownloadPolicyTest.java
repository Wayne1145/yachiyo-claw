package io.github.yachiyoclaw.update;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;

import java.net.URL;
import org.junit.Test;

public class UpdateDownloadPolicyTest {
    @Test
    public void acceptsOnlyOfficialHttpsReleaseUrls() throws Exception {
        assertEquals(
            "github.com",
            UpdateDownloadPolicy.requireInitialReleaseUrl(
                "https://github.com/Wayne1145/yachiyo-claw/releases/download/v0.0.5/app.apk"
            ).getHost()
        );
        assertThrows(IllegalArgumentException.class, () -> UpdateDownloadPolicy.requireInitialReleaseUrl(
            "http://github.com/Wayne1145/yachiyo-claw/releases/download/v0.0.5/app.apk"
        ));
        assertThrows(IllegalArgumentException.class, () -> UpdateDownloadPolicy.requireInitialReleaseUrl(
            "https://github.com/other/repo/releases/download/v0.0.5/app.apk"
        ));
    }

    @Test
    public void acceptsOnlyGithubAssetRedirects() throws Exception {
        UpdateDownloadPolicy.requireAllowedRedirect(new URL("https://release-assets.githubusercontent.com/github-production-release-asset/app.apk"));
        assertThrows(IllegalArgumentException.class, () -> UpdateDownloadPolicy.requireAllowedRedirect(
            new URL("https://example.com/app.apk")
        ));
    }

    @Test
    public void parsesDigestAndSidecarLines() {
        String digest = "a".repeat(64);
        assertEquals(digest, UpdateDownloadPolicy.parseSha256("sha256:" + digest));
        assertEquals(digest, UpdateDownloadPolicy.parseSha256(digest + "  app.apk"));
        assertNull(UpdateDownloadPolicy.parseSha256("not-a-hash"));
    }
}
