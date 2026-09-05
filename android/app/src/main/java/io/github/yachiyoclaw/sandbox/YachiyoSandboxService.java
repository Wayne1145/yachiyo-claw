package io.github.yachiyoclaw.sandbox;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;
import io.github.yachiyoclaw.MainActivity;
import io.github.yachiyoclaw.R;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/** Owns persistent PRoot jobs outside the Activity/WebView lifecycle. */
public final class YachiyoSandboxService extends Service {
    static final String ACTION_START = "io.github.yachiyoclaw.sandbox.START";
    static final String ACTION_STOP = "io.github.yachiyoclaw.sandbox.STOP";
    static final String EXTRA_JOB_ID = "jobId";
    private static final String CHANNEL_ID = "yachiyo_sandbox_jobs";
    private static final int NOTIFICATION_ID = 4102;

    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final Map<String, Process> active = new ConcurrentHashMap<>();
    private final Set<String> launching = ConcurrentHashMap.newKeySet();
    private SandboxJobStore store;

    @Override public void onCreate() {
        super.onCreate();
        store = new SandboxJobStore(this);
        createChannel();
        startForeground(NOTIFICATION_ID, notification("Linux 沙箱后台任务正在运行"));
        try { store.reconcile(System.currentTimeMillis()); } catch (Exception ignored) {}
        executor.execute(this::recoverQueuedJobs);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_STICKY;
        String id = intent.getStringExtra(EXTRA_JOB_ID);
        if (id == null || !id.matches("[A-Za-z0-9_-]{8,80}")) return START_STICKY;
        if (ACTION_STOP.equals(intent.getAction())) stopJob(id);
        else if (ACTION_START.equals(intent.getAction())) scheduleJob(id);
        return START_STICKY;
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public void onDestroy() {
        // Android may recreate this START_STICKY service. Never turn Activity destruction into job cancellation.
        executor.shutdown();
        super.onDestroy();
    }

    static void start(Context context, String id) {
        Intent intent = new Intent(context, YachiyoSandboxService.class).setAction(ACTION_START).putExtra(EXTRA_JOB_ID, id);
        context.startForegroundService(intent);
    }

    static void stop(Context context, String id) {
        Intent intent = new Intent(context, YachiyoSandboxService.class).setAction(ACTION_STOP).putExtra(EXTRA_JOB_ID, id);
        context.startForegroundService(intent);
    }

    private void runJob(String id) {
        try {
            SandboxJobStore.Job job = store.get(id);
            if (job == null || !SandboxJobStore.STATE_QUEUED.equals(job.state)) return;
            File workspace = validateWorkspace(job.workspace);
            RuntimeFiles runtime = resolveRuntime(job.runtimeId);
            ProcessBuilder builder = SandboxProcessFactory.create(
                this,
                runtime.rootfs,
                runtime.runtimeDirectory,
                workspace,
                store.decryptCommand(job),
                runtime.config
            );
            builder.redirectOutput(ProcessBuilder.Redirect.appendTo(store.stdout(id)));
            builder.redirectError(ProcessBuilder.Redirect.appendTo(store.stderr(id)));
            Process process = builder.start();
            active.put(id, process);
            long pid = processId(process);
            SandboxJobStore.Job latestBeforeRun = store.get(id);
            if (latestBeforeRun == null || !SandboxJobStore.STATE_QUEUED.equals(latestBeforeRun.state)) {
                killTree(pid, ConcurrentHashMap.newKeySet());
                process.destroyForcibly();
                return;
            }
            store.update(id, SandboxJobStore.STATE_RUNNING, pid, null, System.currentTimeMillis());
            boolean completed = false;
            boolean outputLimitExceeded = false;
            boolean processDisappeared = false;
            long deadline = System.currentTimeMillis() + job.timeoutMs;
            while (System.currentTimeMillis() < deadline) {
                if (process.waitFor(Math.min(500L, Math.max(1L, deadline - System.currentTimeMillis())), TimeUnit.MILLISECONDS)) {
                    completed = true;
                    break;
                }
                if (!process.isAlive() || (pid > 0L && !isPidAlive(pid))) {
                    processDisappeared = true;
                    break;
                }
                if (store.outputBytes(id) > SandboxJobStore.MAX_OUTPUT_BYTES_PER_STREAM * 2L) {
                    outputLimitExceeded = true;
                    break;
                }
            }
            if (!completed) {
                killTree(pid, ConcurrentHashMap.newKeySet());
                process.destroy();
                process.destroyForcibly();
            }
            int exitCode = completed ? process.exitValue() : outputLimitExceeded ? 125 : processDisappeared ? 126 : 124;
            if (outputLimitExceeded) appendError(id, "sandbox_output_limit_exceeded");
            if (processDisappeared) appendError(id, "sandbox_process_disappeared");
            SandboxJobStore.Job latest = store.get(id);
            if (latest != null && SandboxJobStore.STATE_CANCELLED.equals(latest.state)) return;
            store.update(id, exitCode == 0 ? SandboxJobStore.STATE_SUCCEEDED : SandboxJobStore.STATE_FAILED, pid, exitCode, System.currentTimeMillis());
        } catch (Exception error) {
            appendError(id, safeError(error));
            try { store.update(id, SandboxJobStore.STATE_FAILED, 0L, 1, System.currentTimeMillis()); } catch (Exception ignored) {}
        } finally {
            active.remove(id);
            launching.remove(id);
            stopIfIdle();
        }
    }

    private void recoverQueuedJobs() {
        try {
            for (SandboxJobStore.Job job : store.list()) {
                if (SandboxJobStore.STATE_QUEUED.equals(job.state)) scheduleJob(job.id);
            }
        } catch (Exception ignored) {
            // A later explicit START can retry registry access.
        } finally {
            stopIfIdle();
        }
    }

    private void scheduleJob(String id) {
        if (!launching.add(id)) return;
        try {
            executor.execute(() -> runJob(id));
        } catch (java.util.concurrent.RejectedExecutionException error) {
            launching.remove(id);
            stopIfIdle();
        }
    }

    private RuntimeFiles resolveRuntime(String runtimeId) throws Exception {
        if (UbuntuDistribution.RUNTIME_ID.equals(runtimeId)) {
            UbuntuDistribution.Spec distribution = UbuntuDistribution.current(getApplicationInfo().nativeLibraryDir);
            if (distribution == null) throw new IllegalStateException("ubuntu_abi_unsupported");
            UbuntuDistributionInstaller installer = new UbuntuDistributionInstaller(this, distribution);
            if (!installer.isInstalled()) throw new IllegalStateException("ubuntu_not_installed");
            return new RuntimeFiles(installer.rootfsDirectory(), installer.runtimeDirectory(), SandboxProcessFactory.RuntimeConfig.ubuntu());
        }
        SandboxDistribution.Spec distribution = SandboxDistribution.current(getApplicationInfo().nativeLibraryDir);
        if (distribution == null) throw new IllegalStateException("sandbox_abi_unsupported");
        AlpineSandboxInstaller installer = new AlpineSandboxInstaller(this, distribution);
        if (!installer.isInstalled() || !new File(installer.rootfsDirectory(), ".yachiyo-toolchain-v1").isFile()) {
            throw new IllegalStateException("sandbox_not_ready");
        }
        return new RuntimeFiles(installer.rootfsDirectory(), installer.runtimeDirectory(), SandboxProcessFactory.RuntimeConfig.alpine());
    }

    private void stopJob(String id) {
        Process process = active.remove(id);
        long pid = process == null ? 0L : processId(process);
        if (process != null) {
            killTree(pid, ConcurrentHashMap.newKeySet());
            process.destroy();
            process.destroyForcibly();
        }
        try { store.update(id, SandboxJobStore.STATE_CANCELLED, pid, 130, System.currentTimeMillis()); } catch (Exception ignored) {}
        stopIfIdle();
    }

    private File validateWorkspace(String value) throws Exception {
        File root = new File(getFilesDir(), "linux-sandbox/workspaces").getCanonicalFile();
        File workspace = new File(value).getCanonicalFile();
        if (!workspace.toPath().startsWith(root.toPath())) throw new IllegalStateException("sandbox_workspace_outside_root");
        if (!workspace.isDirectory() && !workspace.mkdirs()) throw new IllegalStateException("sandbox_workspace_unavailable");
        return workspace;
    }

    private void stopIfIdle() {
        if (active.isEmpty() && launching.isEmpty()) stopSelf();
    }

    private void appendError(String id, String message) {
        try (java.io.FileOutputStream output = new java.io.FileOutputStream(store.stderr(id), true)) {
            output.write((message + "\n").getBytes(StandardCharsets.UTF_8));
        } catch (Exception ignored) {}
    }

    private static String safeError(Exception error) {
        String message = error.getMessage();
        return message != null && message.matches("[A-Za-z0-9._-]{1,120}") ? message : "sandbox_background_job_failed";
    }

    private static void killTree(long pid, Set<Long> visited) {
        if (pid <= 0 || !visited.add(pid)) return;
        try {
            String children = new String(Files.readAllBytes(new File("/proc/" + pid + "/task/" + pid + "/children").toPath()), StandardCharsets.US_ASCII).trim();
            if (!children.isEmpty()) for (String child : children.split("\\s+")) killTree(Long.parseLong(child), visited);
        } catch (Exception ignored) {}
        android.os.Process.killProcess((int) pid);
    }

    private static long processId(Process process) {
        try {
            java.lang.reflect.Field field = process.getClass().getDeclaredField("pid");
            field.setAccessible(true);
            return field.getLong(process);
        } catch (Exception ignored) {
            return 0L;
        }
    }

    private static boolean isPidAlive(long pid) {
        return pid > 0L && new File("/proc/" + pid).isDirectory();
    }

    private void createChannel() {
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Linux 沙箱任务", NotificationManager.IMPORTANCE_LOW);
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    private Notification notification(String text) {
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Yachiyo Claw")
            .setContentText(text)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .build();
    }

    private record RuntimeFiles(File rootfs, File runtimeDirectory, SandboxProcessFactory.RuntimeConfig config) {}
}
