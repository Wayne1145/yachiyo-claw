package io.github.yachiyoclaw.model;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import java.io.File;
import java.net.URL;
import org.junit.Test;

public class ModelDownloadPolicyTest {
    @Test
    public void acceptsOnlyOfficialCatalogDownloadOrigins() throws Exception {
        assertEquals("huggingface.co", ModelDownloadPolicy.requireInitialUrl("https://huggingface.co/org/model/resolve/abc/model.litertlm").getHost());
        assertEquals("www.modelscope.cn", ModelDownloadPolicy.requireInitialUrl("https://www.modelscope.cn/api/v1/models/org/model/repo").getHost());
        assertThrows(IllegalArgumentException.class, () -> ModelDownloadPolicy.requireInitialUrl("https://example.com/model.litertlm"));
        assertThrows(IllegalArgumentException.class, () -> ModelDownloadPolicy.requireInitialUrl("http://huggingface.co/model.litertlm"));
    }

    @Test
    public void restrictsRedirectsAndArtifactPaths() throws Exception {
        ModelDownloadPolicy.requireAllowedRedirect(new URL("https://cdn-lfs-us-1.hf.co/file"));
        ModelDownloadPolicy.requireAllowedRedirect(new URL("https://modelscope.oss-cn-beijing.aliyuncs.com/file"));
        assertThrows(IllegalArgumentException.class, () -> ModelDownloadPolicy.requireAllowedRedirect(new URL("https://attacker.example/file")));
        File root = new File(System.getProperty("java.io.tmpdir"), "model-policy-root").getCanonicalFile();
        assertThrows(IllegalArgumentException.class, () -> ModelDownloadPolicy.resolveArtifact(root, "../escape"));
    }

    @Test
    public void enforcesHashAndFifteenGigabyteLimit() {
        assertEquals("a".repeat(64), ModelDownloadPolicy.requireSha256("A".repeat(64)));
        assertEquals(ModelDownloadPolicy.MAX_MODEL_BYTES, ModelDownloadPolicy.requireSize(ModelDownloadPolicy.MAX_MODEL_BYTES));
        assertThrows(IllegalArgumentException.class, () -> ModelDownloadPolicy.requireSize(ModelDownloadPolicy.MAX_MODEL_BYTES + 1));
        assertThrows(IllegalArgumentException.class, () -> ModelDownloadPolicy.requireSha256("not-a-hash"));
    }
}
