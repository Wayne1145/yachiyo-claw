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
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/** File-backed registry shared by the UI process and the isolated sandbox service process. */
final class SandboxJobStore {
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
        return locked(() -> {
            Job job = new Job(id, cipher.encrypt(command), workspace, timeoutMs, STATE_QUEUED, now, now, 0L, null);
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

    synchronized Job update(String id, String state, long pid, Integer exitCode, long now) throws Exception {
        return locked(() -> {
            List<Job> jobs = readAll();
            Job updated = null;
            for (int index = 0; index < jobs.size(); index++) {
                Job current = jobs.get(index);
                if (!current.id.equals(id)) continue;
                updated = new Job(current.id, current.commandCiphertext, current.workspace, current.timeoutMs, state, current.createdAt, now, pid, exitCode);
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
                if (!STATE_RUNNING.equals(job.state) && !STATE_QUEUED.equals(job.state)) continue;
                boolean alive = job.pid > 0 && new File("/proc/" + job.pid).isDirectory();
                if (STATE_QUEUED.equals(job.state) && now - job.createdAt < 30_000) continue;
                if (STATE_RUNNING.equals(job.state) && alive && now < job.createdAt + job.timeoutMs) continue;
                jobs.set(index, new Job(job.id, job.commandCiphertext, job.workspace, job.timeoutMs, STATE_INTERRUPTED, job.createdAt, now, job.pid, null));
                changed = true;
            }
            if (changed) writeAll(jobs);
            return null;
        });
    }

    File stdout(String id) { return new File(directory, id + ".stdout"); }
    File stderr(String id) { return new File(directory, id + ".stderr"); }
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

        Job(String id, String commandCiphertext, String workspace, int timeoutMs, String state, long createdAt, long updatedAt, long pid, Integer exitCode) {
            this.id = id;
            this.commandCiphertext = commandCiphertext;
            this.workspace = workspace;
            this.timeoutMs = timeoutMs;
            this.state = state;
            this.createdAt = createdAt;
            this.updatedAt = updatedAt;
            this.pid = pid;
            this.exitCode = exitCode;
        }

        JSONObject toJson() throws Exception {
            JSONObject value = new JSONObject()
                .put("id", id).put("commandCiphertext", commandCiphertext).put("workspace", workspace)
                .put("timeoutMs", timeoutMs).put("state", state).put("createdAt", createdAt)
                .put("updatedAt", updatedAt).put("pid", pid);
            if (exitCode != null) value.put("exitCode", exitCode);
            return value;
        }

        static Job fromJson(JSONObject value) {
            return new Job(
                value.optString("id"), value.optString("commandCiphertext"), value.optString("workspace"),
                value.optInt("timeoutMs", 120_000), value.optString("state", STATE_INTERRUPTED),
                value.optLong("createdAt"), value.optLong("updatedAt"), value.optLong("pid"),
                value.has("exitCode") ? value.optInt("exitCode") : null
            );
        }

        JSONObject publicJson() throws Exception {
            return new JSONObject()
                .put("id", id).put("state", state).put("timeoutMs", timeoutMs)
                .put("createdAt", createdAt).put("updatedAt", updatedAt).put("pid", pid)
                .put("exitCode", exitCode == null ? JSONObject.NULL : exitCode);
        }
    }
}
