package io.github.yachiyoclaw.sandbox;

import android.content.Context;
import java.io.File;
import java.io.FileOutputStream;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/** File-backed registry shared by the UI process and the isolated sandbox service process. */
final class SandboxJobStore {
    static final long MAX_OUTPUT_BYTES_PER_STREAM = 8L * 1024L * 1024L;
    static final String STATE_QUEUED = "queued";
    static final String STATE_RUNNING = "running";
    static final String STATE_SUCCEEDED = "succeeded";
    static final String STATE_FAILED = "failed";
    static final String STATE_CANCELLED = "cancelled";
    static final String STATE_INTERRUPTED = "interrupted";

    private final File directory;
    private final File registry;
    private final File lockFile;
    private final SandboxJobCipher cipher = new SandboxJobCipher();

    SandboxJobStore(Context context) {
        directory = new File(context.getFilesDir(), "linux-sandbox/jobs");
        registry = new File(directory, "registry-v1.json");
        lockFile = new File(directory, "registry-v1.lock");
    }

    synchronized Job create(String id, String command, String workspace, int timeoutMs, long now) throws Exception {
        return create(id, command, workspace, timeoutMs, now, "alpine");
    }

    synchronized Job create(String id, String command, String workspace, int timeoutMs, long now, String runtimeId) throws Exception {
        return locked(() -> {
            Job job = new Job(id, cipher.encrypt(command), workspace, timeoutMs, STATE_QUEUED, now, now, 0L, null, runtimeId);
            List<Job> jobs = readAll();
            jobs.removeIf(item -> item.id.equals(id));
            jobs.add(job);
            writeAll(jobs);
            return job;
        });
    }

    synchronized Job get(String id) throws Exception {
        return locked(() -> {
            for (Job job : readAll()) if (job.id.equals(id)) return job;
            return null;
        });
    }

    synchronized List<Job> list() throws Exception {
        return locked(() -> {
            List<Job> jobs = readAll();
            jobs.sort(Comparator.comparingLong((Job job) -> job.createdAt).reversed());
            return jobs;
        });
    }

    static List<String> jobIdsForWorkspace(List<Job> jobs, String workspace) {
        List<String> ids = new ArrayList<>();
        for (Job job : jobs) if (workspace.equals(job.workspace)) ids.add(job.id);
        return ids;
    }

    /** Removes terminal metadata and bounded output files after the owner has stopped the jobs. */
    synchronized void removeJobs(List<String> ids) throws Exception {
        if (ids.isEmpty()) return;
        Set<String> selected = new HashSet<>(ids);
        locked(() -> {
            List<Job> jobs = readAll();
            jobs.removeIf(job -> selected.contains(job.id));
            writeAll(jobs);
            for (String id : selected) {
                Files.deleteIfExists(stdout(id).toPath());
                Files.deleteIfExists(stderr(id).toPath());
            }
            return null;
        });
    }

    synchronized Job update(String id, String state, long pid, Integer exitCode, long now) throws Exception {
        return locked(() -> {
            List<Job> jobs = readAll();
            Job updated = null;
            for (int index = 0; index < jobs.size(); index++) {
                Job current = jobs.get(index);
                if (!current.id.equals(id)) continue;
                updated = new Job(current.id, current.commandCiphertext, current.workspace, current.timeoutMs, state, current.createdAt, now, pid, exitCode, current.runtimeId);
                jobs.set(index, updated);
                break;
            }
            if (updated == null) return null;
            writeAll(jobs);
            return updated;
        });
    }

    synchronized void reconcile(long now) throws Exception {
        locked(() -> {
            List<Job> jobs = readAll();
            boolean changed = false;
            for (int index = 0; index < jobs.size(); index++) {
                Job job = jobs.get(index);
                if (!STATE_RUNNING.equals(job.state)) continue;
                boolean alive = job.pid > 0 && new File("/proc/" + job.pid).isDirectory();
                if (!shouldInterrupt(job, now, alive)) continue;
                jobs.set(index, new Job(job.id, job.commandCiphertext, job.workspace, job.timeoutMs, STATE_INTERRUPTED, job.createdAt, now, job.pid, null, job.runtimeId));
                changed = true;
            }
            if (changed) writeAll(jobs);
            return null;
        });
    }

    static boolean shouldInterrupt(Job job, long now, boolean processAlive) {
        if (!STATE_RUNNING.equals(job.state)) return false;
        long startedAt = Math.max(job.createdAt, job.updatedAt);
        long elapsed = Math.max(0L, now - startedAt);
        return !processAlive || elapsed >= job.timeoutMs;
    }

    File stdout(String id) { return new File(directory, id + ".stdout"); }
    File stderr(String id) { return new File(directory, id + ".stderr"); }
    long outputBytes(String id) { return stdout(id).length() + stderr(id).length(); }
    String decryptCommand(Job job) throws Exception { return cipher.decrypt(job.commandCiphertext); }

    private <T> T locked(JobStoreAction<T> action) throws Exception {
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("sandbox_job_store_unavailable");
        try (RandomAccessFile file = new RandomAccessFile(lockFile, "rw"); java.nio.channels.FileLock ignored = file.getChannel().lock()) {
            return action.run();
        }
    }

    private interface JobStoreAction<T> { T run() throws Exception; }

    private List<Job> readAll() throws Exception {
        List<Job> result = new ArrayList<>();
        if (!registry.isFile()) return result;
        JSONArray array = new JSONArray(new String(Files.readAllBytes(registry.toPath()), StandardCharsets.UTF_8));
        for (int index = 0; index < array.length(); index++) result.add(Job.fromJson(array.getJSONObject(index)));
        return result;
    }

    private void writeAll(List<Job> jobs) throws Exception {
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("sandbox_job_store_unavailable");
        JSONArray array = new JSONArray();
        for (Job job : jobs) array.put(job.toJson());
        File temporary = new File(directory, registry.getName() + ".tmp");
        try (FileOutputStream output = new FileOutputStream(temporary)) {
            output.write(array.toString().getBytes(StandardCharsets.UTF_8));
            output.getFD().sync();
        }
        try {
            Files.move(temporary.toPath(), registry.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (java.nio.file.AtomicMoveNotSupportedException ignored) {
            Files.move(temporary.toPath(), registry.toPath(), StandardCopyOption.REPLACE_EXISTING);
        }
    }

    static final class Job {
        final String id;
        final String commandCiphertext;
        final String workspace;
        final int timeoutMs;
        final String state;
        final long createdAt;
        final long updatedAt;
        final long pid;
        final Integer exitCode;
        final String runtimeId;

        Job(String id, String commandCiphertext, String workspace, int timeoutMs, String state, long createdAt, long updatedAt, long pid, Integer exitCode) {
            this(id, commandCiphertext, workspace, timeoutMs, state, createdAt, updatedAt, pid, exitCode, "alpine");
        }

        Job(String id, String commandCiphertext, String workspace, int timeoutMs, String state, long createdAt, long updatedAt, long pid, Integer exitCode, String runtimeId) {
            this.id = id;
            this.commandCiphertext = commandCiphertext;
            this.workspace = workspace;
            this.timeoutMs = timeoutMs;
            this.state = state;
            this.createdAt = createdAt;
            this.updatedAt = updatedAt;
            this.pid = pid;
            this.exitCode = exitCode;
            this.runtimeId = runtimeId == null || runtimeId.isBlank() ? "alpine" : runtimeId;
        }

        JSONObject toJson() throws Exception {
            JSONObject value = new JSONObject()
                .put("id", id).put("commandCiphertext", commandCiphertext).put("workspace", workspace)
                .put("timeoutMs", timeoutMs).put("state", state).put("createdAt", createdAt)
                .put("updatedAt", updatedAt).put("pid", pid).put("runtimeId", runtimeId);
            if (exitCode != null) value.put("exitCode", exitCode);
            return value;
        }

        static Job fromJson(JSONObject value) {
            return new Job(
                value.optString("id"), value.optString("commandCiphertext"), value.optString("workspace"),
                value.optInt("timeoutMs", 120_000), value.optString("state", STATE_INTERRUPTED),
                value.optLong("createdAt"), value.optLong("updatedAt"), value.optLong("pid"),
                value.has("exitCode") ? value.optInt("exitCode") : null,
                value.optString("runtimeId", "alpine")
            );
        }

        JSONObject publicJson() throws Exception {
            return new JSONObject()
                .put("id", id).put("state", state).put("timeoutMs", timeoutMs)
                .put("createdAt", createdAt).put("updatedAt", updatedAt).put("pid", pid).put("runtimeId", runtimeId)
                .put("exitCode", exitCode == null ? JSONObject.NULL : exitCode);
        }
    }
}
