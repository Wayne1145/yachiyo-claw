package io.github.yachiyoclaw.model;

import android.content.Context;
import com.google.mediapipe.tasks.core.BaseOptions;
import com.google.mediapipe.tasks.components.containers.Embedding;
import com.google.mediapipe.tasks.text.textembedder.TextEmbedder;
import com.google.mediapipe.tasks.text.textembedder.TextEmbedderResult;
import java.io.File;
import java.io.FileInputStream;
import java.nio.MappedByteBuffer;
import java.nio.channels.FileChannel;
import java.util.List;
import org.json.JSONArray;

/** Process-wide owner for a downloaded MediaPipe Text Embedder model. */
final class MediaPipeTextEmbeddingRunner {
    private static String loadedPath;
    private static TextEmbedder loadedEmbedder;

    private MediaPipeTextEmbeddingRunner() {}

    static synchronized JSONArray embed(Context context, String modelPath, JSONArray texts) throws Exception {
        TextEmbedder embedder = ensureLoaded(context, modelPath);
        JSONArray result = new JSONArray();
        for (int textIndex = 0; textIndex < texts.length(); textIndex++) {
            TextEmbedderResult embedded = embedder.embed(texts.getString(textIndex));
            List<Embedding> embeddings = embedded.embeddingResult().embeddings();
            if (embeddings.isEmpty()) throw new IllegalStateException("embedding_output_missing");
            float[] values = embeddings.get(0).floatEmbedding();
            if (values.length == 0 || values.length > 4096) throw new IllegalStateException("embedding_dimension_invalid");
            JSONArray vector = new JSONArray();
            double norm = 0;
            for (float value : values) {
                if (!Float.isFinite(value)) throw new IllegalStateException("embedding_value_invalid");
                norm += value * value;
            }
            double scale = norm > 0 ? Math.sqrt(norm) : 1;
            for (float value : values) vector.put(value / scale);
            result.put(vector);
        }
        return result;
    }

    static synchronized void unload() {
        if (loadedEmbedder != null) loadedEmbedder.close();
        loadedEmbedder = null;
        loadedPath = null;
    }

    private static TextEmbedder ensureLoaded(Context context, String path) throws Exception {
        File model = new File(path).getCanonicalFile();
        if (!model.isFile() || !model.getName().toLowerCase().endsWith(".tflite")) {
            throw new IllegalArgumentException("local_embedding_model_file_missing");
        }
        if (loadedEmbedder != null && model.getPath().equals(loadedPath)) return loadedEmbedder;
        unload();
        MappedByteBuffer buffer;
        try (FileInputStream input = new FileInputStream(model); FileChannel channel = input.getChannel()) {
            buffer = channel.map(FileChannel.MapMode.READ_ONLY, 0, channel.size());
        }
        BaseOptions baseOptions = BaseOptions.builder().setModelAssetBuffer(buffer).build();
        TextEmbedder.TextEmbedderOptions options = TextEmbedder.TextEmbedderOptions.builder().setBaseOptions(baseOptions).build();
        loadedEmbedder = TextEmbedder.createFromOptions(context, options);
        loadedPath = model.getPath();
        return loadedEmbedder;
    }
}
