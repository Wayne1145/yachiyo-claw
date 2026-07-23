package io.github.yachiyoclaw.model;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.io.FileOutputStream;
import org.junit.Test;

public final class LocalModelFormatTest {
    @Test
    public void acceptsSingleGgufAndFirstShardOnly() {
        assertTrue(LocalModelFormat.isRunnableGgufPath("gemma.gguf"));
        assertTrue(LocalModelFormat.isRunnableGgufPath("gemma-Q4_K_M-00001-of-00003.gguf"));
        assertFalse(LocalModelFormat.isRunnableGgufPath("gemma-Q4_K_M-00002-of-00003.gguf"));
        assertFalse(LocalModelFormat.isRunnableGgufPath("gemma.bin"));
    }

    @Test
    public void firstShardBecomesRegisteredRuntimePath() {
        String first = LocalModelFormat.chooseRuntimePath(null, "gguf", new File("model-00001-of-00002.gguf"));
        String second = LocalModelFormat.chooseRuntimePath(first, "gguf", new File("model-00002-of-00002.gguf"));
        assertEquals(first, second);
    }

    @Test
    public void preservesExistingRuntimeFormats() {
        assertTrue(LocalModelFormat.isRunnableArtifact("litertlm", "model.data"));
        assertTrue(LocalModelFormat.isRunnableArtifact("tflite", "embedding.data"));
        assertEquals("llama.cpp", LocalModelFormat.runtimeForPath("gemma.gguf"));
    }

    @Test
    public void validatesGgufMagicBeforeNativeParsing() throws Exception {
        File valid = File.createTempFile("yachiyo-model", ".gguf");
        File invalid = File.createTempFile("yachiyo-invalid", ".gguf");
        try {
            try (FileOutputStream output = new FileOutputStream(valid)) {
                output.write(new byte[] { 'G', 'G', 'U', 'F', 3, 0, 0, 0 });
            }
            try (FileOutputStream output = new FileOutputStream(invalid)) {
                output.write(new byte[] { 'N', 'O', 'P', 'E', 0, 0, 0, 0 });
            }
            assertTrue(LocalModelFormat.hasValidGgufHeader(valid));
            assertFalse(LocalModelFormat.hasValidGgufHeader(invalid));
        } finally {
            valid.delete();
            invalid.delete();
        }
    }
}
