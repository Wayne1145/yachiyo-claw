package io.github.yachiyoclaw.download;

import android.content.Context;
import androidx.work.WorkManager;
import java.io.File;
import org.json.JSONObject;

/** Native-to-native facade for large app-owned assets that must bypass the WebView bridge. */
public final class GenericDownloadCoordinator {
    private GenericDownloadCoordinator() {}

    public static synchronized void enqueue(
        Context context,
        String id,
        String kind,
        String title,
        String url,
        String fallbackUrl,
        long expectedSize,
        String expectedSha256
    ) throws Exception {
        if (id == null || !id.matches("[A-Za-z0-9._-]{1,100}")) throw new IllegalArgumentException("download_task_id_invalid");
        if (kind == null || !kind.matches("[a-z0-9._-]{1,32}")) throw new IllegalArgumentException("download_kind_invalid");
        if (title == null || title.isBlank() || title.length() > 120) throw new IllegalArgumentException("download_title_invalid");
        if (expectedSize <= 0 || expectedSize > GenericDownloadWorker.MAX_BYTES) throw new IllegalArgumentException("download_size_invalid");
        String digest = expectedSha256 == null ? "" : expectedSha256.trim().toLowerCase();
        if (!digest.matches("[a-f0-9]{64}")) throw new IllegalArgumentException("download_digest_invalid");
        GenericDownloadWorker.requireHttpsSyntax(url);
        if (fallbackUrl != null && !fallbackUrl.isBlank()) GenericDownloadWorker.requireHttpsSyntax(fallbackUrl);
        JSONObject request = new JSONObject()
            .put("id", id).put("kind", kind).put("title", title).put("url", url)
            .put("expectedSize", expectedSize).put("expectedSha256", digest);
        if (fallbackUrl != null && !fallbackUrl.isBlank() && !fallbackUrl.equals(url)) request.put("fallbackUrl", fallbackUrl);
        JSONObject existing = GenericDownloadStore.get(context, id);
        if (existing != null && !GenericDownloadStore.sameRequest(existing, request)) {
            throw new IllegalArgumentException("download_task_id_conflict");
        }
        GenericDownloadStore.save(context, request);
        File artifact = GenericDownloadWorker.artifact(context, id);
        long resumable = DownloadTransfer.resumableBytes(artifact, expectedSize);
        DownloadTaskStore.updateGeneric(context, id, kind, title, "queued", resumable, expectedSize, 0, null);
        GenericDownloadWorker.enqueue(context, id);
    }

    public static JSONObject task(Context context, String id) {
        return DownloadTaskStore.get(context, id);
    }

    public static File requireCompletedArtifact(Context context, String id, long expectedSize) {
        JSONObject task = DownloadTaskStore.get(context, id);
        File file = GenericDownloadWorker.artifact(context, id);
        if (task == null || !"completed".equals(task.optString("status"))) {
            throw new IllegalStateException("download_not_completed");
        }
        if (!file.isFile() || file.length() != expectedSize) throw new IllegalStateException("download_artifact_missing");
        return file;
    }

    public static void discard(Context context, String id) {
        WorkManager.getInstance(context).cancelUniqueWork(GenericDownloadWorker.workName(id));
        DownloadTransfer.discard(GenericDownloadWorker.artifact(context, id));
        GenericDownloadStore.remove(context, id);
        DownloadTaskStore.releaseGenericPayload(context, id);
    }
}
