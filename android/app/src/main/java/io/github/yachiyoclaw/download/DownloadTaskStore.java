package io.github.yachiyoclaw.download;

import android.content.Context;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Small durable transfer index used by the unified Downloads screen.
 *
 * <p>The persistence glue uses {@code org.json} (stubbed on the JVM), so the bounded-history and
 * ordering decisions live in {@link #idsToDrop} / {@link #displayOrder} which operate on plain
 * records and are covered by unit tests.
 */
public final class DownloadTaskStore {
    private static final String PREFS = "yachiyo-download-tasks";
    private static final String KEY = "tasks";
    /** Keep at most this many finished (completed/failed/cancelled) rows; oldest evicted first. */
    static final int MAX_TERMINAL = 40;
    /** Target row ceiling; active/recoverable payloads may temporarily exceed it. */
    static final int MAX_TASKS = 120;

    private DownloadTaskStore() {}

    /** Lightweight view of a stored task used by the pure eviction/ordering helpers. */
    static final class TaskMeta {
        final String id;
        final String status;
        final long updatedAt;
        final boolean retainedPayload;
        TaskMeta(String id, String status, long updatedAt) { this(id, status, updatedAt, false); }
        TaskMeta(String id, String status, long updatedAt, boolean retainedPayload) {
            this.id = id;
            this.status = status;
            this.updatedAt = updatedAt;
            this.retainedPayload = retainedPayload;
        }
    }

    static boolean isTerminal(String status) {
        return "completed".equals(status) || "failed".equals(status) || "cancelled".equals(status);
    }

    /** Ids that must be dropped to keep terminal history and total size within bounds. Pure. */
    static Set<String> idsToDrop(List<TaskMeta> tasks, int maxTerminal, int maxTasks) {
        Set<String> drop = new HashSet<>();
        List<TaskMeta> terminal = new ArrayList<>();
        for (TaskMeta t : tasks) if (isTerminal(t.status) && !t.retainedPayload) terminal.add(t);
        terminal.sort(Comparator.comparingLong(t -> t.updatedAt));
        for (int i = 0; i < terminal.size() - maxTerminal; i++) drop.add(terminal.get(i).id);
        int remaining = tasks.size() - drop.size();
        if (remaining > maxTasks) {
            // Active work and completed artifacts awaiting a consumer are never history entries.
            List<TaskMeta> ordered = new ArrayList<>();
            for (TaskMeta t : tasks) {
                if (!drop.contains(t.id) && isTerminal(t.status) && !t.retainedPayload) ordered.add(t);
            }
            ordered.sort(Comparator.comparingLong(t -> t.updatedAt));
            int needed = remaining - maxTasks;
            for (int i = 0; i < Math.min(needed, ordered.size()); i++) drop.add(ordered.get(i).id);
        }
        return drop;
    }

    /** Display order: active tasks first, then most recently updated. Pure. */
    static List<TaskMeta> displayOrder(List<TaskMeta> tasks) {
        List<TaskMeta> sorted = new ArrayList<>(tasks);
        sorted.sort((a, b) -> {
            int ta = isTerminal(a.status) ? 1 : 0;
            int tb = isTerminal(b.status) ? 1 : 0;
            if (ta != tb) return Integer.compare(ta, tb);
            return Long.compare(b.updatedAt, a.updatedAt);
        });
        return sorted;
    }

    public static synchronized void update(Context context, String id, String kind, String title, String status, long bytes, long total, long speed, String error) {
        updateInternal(context, id, kind, title, status, bytes, total, speed, error, false);
    }

    /** Creates or refreshes a generic task whose request/fragments/artifact must remain recoverable. */
    static synchronized void updateGeneric(Context context, String id, String kind, String title, String status, long bytes, long total, long speed, String error) {
        updateInternal(context, id, kind, title, status, bytes, total, speed, error, true);
    }

    private static void updateInternal(Context context, String id, String kind, String title, String status, long bytes, long total, long speed, String error, boolean retainGenericPayload) {
        Context app = context.getApplicationContext();
        try {
            JSONObject root = new JSONObject(prefs(app).getString(KEY, "{}"));
            reconcileGenericRows(app, root);
            long now = System.currentTimeMillis();
            JSONObject task = root.optJSONObject(id);
            if (task == null) task = new JSONObject().put("id", id).put("kind", kind).put("title", title).put("createdAt", now);
            task.put("kind", task.optString("kind", kind))
                .put("title", title == null || title.isEmpty() ? task.optString("title", kind) : title)
                .put("status", status)
                .put("bytesDownloaded", Math.max(0, bytes))
                .put("bytesTotal", Math.max(0, total))
                .put("bytesPerSecond", Math.max(0, speed))
                .put("updatedAt", now);
            if (retainGenericPayload) task.put("generic", true).put("retainedPayload", true);
            if (error == null) task.remove("error"); else task.put("error", error);
            root.put(id, task);
            List<JSONObject> evicted = evict(root);
            if (!prefs(app).edit().putString(KEY, root.toString()).commit()) return;
            cleanupEvicted(app, evicted);
        } catch (Exception ignored) {}
    }

    private static List<JSONObject> evict(JSONObject root) throws org.json.JSONException {
        List<TaskMeta> tasks = new ArrayList<>();
        java.util.Iterator<String> keys = root.keys();
        while (keys.hasNext()) {
            JSONObject task = root.getJSONObject(keys.next());
            tasks.add(new TaskMeta(
                task.optString("id"),
                task.optString("status"),
                task.optLong("updatedAt", 0),
                task.optBoolean("retainedPayload", false)
            ));
        }
        List<JSONObject> evicted = new ArrayList<>();
        for (String id : idsToDrop(tasks, MAX_TERMINAL, MAX_TASKS)) {
            JSONObject task = root.optJSONObject(id);
            if (task != null) evicted.add(task);
            root.remove(id);
        }
        return evicted;
    }

    /** Marks generic bytes as consumed before the row becomes eligible for normal history eviction. */
    static synchronized void releaseGenericPayload(Context context, String id) {
        Context app = context.getApplicationContext();
        try {
            JSONObject root = new JSONObject(prefs(app).getString(KEY, "{}"));
            JSONObject task = root.optJSONObject(id);
            if (task == null) return;
            task.put("retainedPayload", false).put("updatedAt", System.currentTimeMillis());
            root.put(id, task);
            List<JSONObject> evicted = evict(root);
            if (!prefs(app).edit().putString(KEY, root.toString()).commit()) return;
            cleanupEvicted(app, evicted);
        } catch (Exception ignored) {}
    }

    private static void cleanupEvicted(Context context, List<JSONObject> evicted) {
        for (JSONObject task : evicted) {
            String id = task.optString("id", "");
            if (id.isEmpty()) continue;
            if (task.optBoolean("generic", false) && !task.optBoolean("retainedPayload", false)) {
                GenericDownloadStore.remove(context, id);
                DownloadTransfer.discard(GenericDownloadWorker.artifact(context, id));
            }
            DownloadNotifications.cancelAndRelease(context, id);
        }
    }

    public static synchronized JSONObject get(Context context, String id) {
        try { return new JSONObject(prefs(context.getApplicationContext()).getString(KEY, "{}")).optJSONObject(id); }
        catch (Exception ignored) { return null; }
    }

    public static synchronized String status(Context context, String id) {
        JSONObject task = get(context, id);
        return task == null ? "" : task.optString("status", "");
    }

    /** Download workers poll this so pause/cancel from the unified screen takes effect immediately. */
    public static synchronized boolean shouldStop(Context context, String id) {
        String status = status(context, id);
        return "paused".equals(status) || "cancelled".equals(status);
    }

    /** A replaced Worker must not overwrite the queued/downloading state owned by its successor. */
    public static boolean shouldIgnoreStoppedWorkerResult(String storedStatus, boolean workerStopped) {
        return workerStopped && !"paused".equals(storedStatus) && !"cancelled".equals(storedStatus);
    }

    public static synchronized void transition(Context context, String id, String status) {
        JSONObject task = get(context, id);
        if (task == null) return;
        update(
            context,
            id,
            task.optString("kind", "download"),
            task.optString("title", "下载任务"),
            status,
            task.optLong("bytesDownloaded", 0),
            task.optLong("bytesTotal", 0),
            0,
            null
        );
    }

    public static synchronized void remove(Context context, String id) {
        Context app = context.getApplicationContext();
        try {
            JSONObject root = new JSONObject(prefs(app).getString(KEY, "{}"));
            JSONObject task = root.optJSONObject(id);
            // A generic payload awaiting retry/consumption must be explicitly discarded first.
            if (task != null && task.optBoolean("retainedPayload", false)) return;
            root.remove(id);
            if (!prefs(app).edit().putString(KEY, root.toString()).commit()) return;
            if (task != null) cleanupEvicted(app, java.util.Collections.singletonList(task));
        } catch (Exception ignored) {}
    }

    public static synchronized JSONArray list(Context context) {
        JSONArray result = new JSONArray();
        try {
            Context app = context.getApplicationContext();
            JSONObject root = new JSONObject(prefs(app).getString(KEY, "{}"));
            if (reconcileGenericRows(app, root)) prefs(app).edit().putString(KEY, root.toString()).commit();
            cleanupOrphanGenericFiles(app, root, GenericDownloadStore.snapshot(app));
            List<TaskMeta> metas = new ArrayList<>();
            java.util.Iterator<String> keys = root.keys();
            while (keys.hasNext()) {
                JSONObject task = root.getJSONObject(keys.next());
                metas.add(new TaskMeta(
                    task.optString("id"),
                    task.optString("status"),
                    task.optLong("updatedAt", 0),
                    task.optBoolean("retainedPayload", false)
                ));
            }
            for (TaskMeta meta : displayOrder(metas)) result.put(root.getJSONObject(meta.id));
        } catch (Exception ignored) {}
        return result;
    }

    /** Repairs legacy/interrupted generic rows before history eviction can strand valid bytes. */
    private static boolean reconcileGenericRows(Context context, JSONObject tasks) throws org.json.JSONException {
        JSONObject requests = GenericDownloadStore.snapshot(context);
        boolean changed = false;
        java.util.Iterator<String> ids = requests.keys();
        while (ids.hasNext()) {
            String id = ids.next();
            JSONObject request = requests.optJSONObject(id);
            if (request == null) continue;
            JSONObject task = tasks.optJSONObject(id);
            if (task == null) {
                long now = System.currentTimeMillis();
                long total = request.optLong("expectedSize", 0);
                long bytes = DownloadTransfer.resumableBytes(GenericDownloadWorker.artifact(context, id), total);
                boolean complete = total > 0 && GenericDownloadWorker.artifact(context, id).isFile()
                    && GenericDownloadWorker.artifact(context, id).length() == total;
                task = new JSONObject()
                    .put("id", id)
                    .put("kind", request.optString("kind", "resource"))
                    .put("title", request.optString("title", "Download"))
                    .put("status", complete ? "completed" : "paused")
                    .put("bytesDownloaded", complete ? total : bytes)
                    .put("bytesTotal", total)
                    .put("bytesPerSecond", 0)
                    .put("createdAt", now)
                    .put("updatedAt", now);
                tasks.put(id, task);
                changed = true;
            }
            if (!task.optBoolean("generic", false) || !task.optBoolean("retainedPayload", false)) {
                task.put("generic", true).put("retainedPayload", true);
                tasks.put(id, task);
                changed = true;
            }
        }
        return changed;
    }

    private static void cleanupOrphanGenericFiles(Context context, JSONObject tasks, JSONObject requests) {
        java.io.File directory = new java.io.File(context.getFilesDir(), "download-cache/generic");
        java.io.File[] files = directory.listFiles();
        if (files == null) return;
        Set<String> checked = new HashSet<>();
        for (java.io.File file : files) {
            String name = file.getName();
            int marker = name.indexOf(".bin");
            if (marker <= 0) continue;
            String id = name.substring(0, marker);
            if (!checked.add(id)) continue;
            JSONObject task = tasks.optJSONObject(id);
            boolean retained = task != null && task.optBoolean("retainedPayload", false);
            if (requests.optJSONObject(id) == null && !retained) {
                DownloadTransfer.discard(GenericDownloadWorker.artifact(context, id));
            }
        }
    }

    private static android.content.SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
