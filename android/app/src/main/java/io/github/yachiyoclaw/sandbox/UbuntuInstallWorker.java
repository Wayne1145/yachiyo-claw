package io.github.yachiyoclaw.sandbox;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.annotation.NonNull;
import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.File;
import java.io.IOException;
import java.util.UUID;

/** Resumes a user-requested Ubuntu installation when its verified archive is available. */
public final class UbuntuInstallWorker extends Worker {
    private static final String UNIQUE_WORK = "yachiyo-ubuntu-24.04-install";
    private static final String REQUEST = "setupJobId";
    private static final String REMOVED = "removed";
    private static final String FOREGROUND_REQUIRED = "ubuntu_configuration_foreground_required";
    private static volatile String extractingJobId;
    // Exact command from the APKs that did not persist a dedicated installation job ID.
    private static final String LEGACY_COMMAND = "set -eu; export DEBIAN_FRONTEND=noninteractive; " +
        "apt-get update; apt-get install -y --no-install-recommends " +
        "bash ca-certificates curl wget git openssh-client python3 python3-pip python3-venv " +
        "nodejs npm build-essential cmake ninja-build pkg-config unzip zip jq ripgrep; " +
        "apt-get clean; rm -rf /var/lib/apt/lists/*; " +
        "python3 --version; node --version; npm --version; git --version; touch /.yachiyo-toolchain-v1";

    public UbuntuInstallWorker(@NonNull Context context, @NonNull WorkerParameters parameters) {
        super(context, parameters);
    }

    record Status(String state, String error, String jobId) {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences("ubuntu-install", Context.MODE_PRIVATE);
    }

    private static void saveId(Context context, String id) throws IOException {
        if (!prefs(context).edit().putString(REQUEST, id).commit()) throw new IOException("ubuntu_install_state_unavailable");
    }

    private static boolean active(SandboxJobStore.Job job) {
        return job != null && (SandboxJobStore.STATE_QUEUED.equals(job.state) || SandboxJobStore.STATE_RUNNING.equals(job.state));
    }

    static boolean reuseRequest(String id, SandboxJobStore.Job previous) {
        return id != null && !REMOVED.equals(id) && (previous == null || active(previous));
    }

    static Status describe(boolean ready, boolean installed, String download, String error, SandboxJobStore.Job job) {
        if (ready) return new Status("ready", null, null);
        String id = job == null ? null : job.id;
        if (installed && FOREGROUND_REQUIRED.equals(error)) return new Status("configuration_required", null, id);
        if (error != null) return new Status("failed", error, id);
        if (!installed) return new Status(download, null, null);
        if (active(job)) return new Status("configuring", null, id);
        if (job == null) return new Status("configuration_required", null, null);
        String reason = switch (job.state) {
            case SandboxJobStore.STATE_FAILED -> job.exitCode == null ? "ubuntu_configuration_failed" : "ubuntu_configuration_exit_" + job.exitCode;
            case SandboxJobStore.STATE_SUCCEEDED -> "ubuntu_toolchain_marker_missing";
            case SandboxJobStore.STATE_CANCELLED -> "ubuntu_configuration_cancelled";
            default -> "ubuntu_configuration_interrupted";
        };
        return new Status("failed", reason, id);
    }

    private static SandboxJobStore.Job setupJob(Context context, UbuntuDistributionInstaller installer, SandboxJobStore store) throws Exception {
        if (!installer.isInstalled()) return null;
        store.reconcile(System.currentTimeMillis());
        String id = prefs(context).getString(REQUEST, null);
        if (id != null) return REMOVED.equals(id) ? null : store.get(id);
        String workspace = pluginWorkspace(context).getCanonicalPath();
        // A normal Ubuntu command may also run for an hour. Never adopt it as the installer.
        SandboxJobStore.Job latestTerminal = null;
        for (SandboxJobStore.Job candidate : store.list()) {
            if (!UbuntuDistribution.RUNTIME_ID.equals(candidate.runtimeId) || !workspace.equals(candidate.workspace) || candidate.timeoutMs != 3_600_000) continue;
            String command = store.decryptCommand(candidate);
            if (!LEGACY_COMMAND.equals(command) && !UbuntuAptBootstrap.command().equals(command)) continue;
            if (active(candidate)) { saveId(context, candidate.id); return candidate; }
            if (latestTerminal == null) latestTerminal = candidate;
        }
        if (latestTerminal != null) saveId(context, latestTerminal.id);
        return latestTerminal;
    }

    static Status status(Context context, UbuntuDistributionInstaller installer, SandboxJobStore store) throws Exception {
        if (installer.isReady()) return new Status("ready", null, null);
        String extracting = extractingJobId;
        if (extracting != null) return new Status("extracting", null, extracting);
        if (!installer.isInstalled()) {
            boolean removed = REMOVED.equals(prefs(context).getString(REQUEST, null));
            return describe(false, false, removed ? "not_downloaded" : installer.downloadState(),
                UbuntuDistributionInstaller.lastInstallError(context), null);
        }
        synchronized (UbuntuInstallWorker.class) {
            return describe(installer.isReady(), installer.isInstalled(), installer.downloadState(),
                UbuntuDistributionInstaller.lastInstallError(context), setupJob(context, installer, store));
        }
    }

    static synchronized Status request(Context context, UbuntuDistributionInstaller installer, SandboxJobStore store) throws Exception {
        if (installer.isReady()) return new Status("ready", null, null);
        SandboxJobStore.Job previous = setupJob(context, installer, store);
        String id = prefs(context).getString(REQUEST, null);
        if (!reuseRequest(id, previous)) {
            id = "job_" + UUID.randomUUID().toString().replace("-", "");
            saveId(context, id);
            previous = null;
        }
        UbuntuDistributionInstaller.recordInstallError(context, null);
        try {
            if (installer.isInstalled()) {
                startConfiguration(context, store, id, previous);
                return new Status("configuring", null, id);
            }
            if ("completed".equals(installer.downloadState())) {
                enqueue(context, id);
                return new Status("installing", null, id);
            }
            installer.enqueueDownload();
            return new Status("downloading", null, id);
        } catch (Exception error) {
            UbuntuDistributionInstaller.recordInstallError(context, error);
            throw error;
        }
    }

    private static void startConfiguration(Context context, SandboxJobStore store, String id, SandboxJobStore.Job previous) throws Exception {
        if (previous == null) {
            File workspace = pluginWorkspace(context);
            if (!workspace.isDirectory() && !workspace.mkdirs()) throw new IOException("plugin_workspace_unavailable");
            store.create(id, UbuntuAptBootstrap.command(), workspace.getCanonicalPath(), 3_600_000, System.currentTimeMillis(), UbuntuDistribution.RUNTIME_ID);
        } else if (!SandboxJobStore.STATE_QUEUED.equals(previous.state)) return;
        try {
            YachiyoSandboxService.start(context, id);
        } catch (IllegalStateException error) {
            if (android.os.Build.VERSION.SDK_INT >= 31 && error instanceof android.app.ForegroundServiceStartNotAllowedException) {
                // Android can defer the handoff after a background download. The Activity resumes this same job.
                throw new IOException(FOREGROUND_REQUIRED, error);
            }
            throw error;
        }
    }

    private static void enqueue(Context context, String id) {
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(UbuntuInstallWorker.class)
            .setInputData(new Data.Builder().putString(REQUEST, id).build()).addTag(UNIQUE_WORK).build();
        WorkManager.getInstance(context).enqueueUniqueWork(UNIQUE_WORK + "-" + id, ExistingWorkPolicy.KEEP, request);
    }

    /** Completion is durable even after a long user pause. Unrelated downloads cannot start Ubuntu. */
    public static void onDownloadCompleted(Context context, String downloadId) {
        if (!"ubuntu-24.04-amd64".equals(downloadId) && !"ubuntu-24.04-arm64".equals(downloadId)) return;
        UbuntuDistribution.Spec spec = UbuntuDistribution.current(context.getApplicationInfo().nativeLibraryDir);
        if (spec == null || !spec.downloadId().equals(downloadId)) return;
        String id = prefs(context).getString(REQUEST, null);
        if (id != null && !REMOVED.equals(id)) {
            try { enqueue(context, id); }
            catch (RuntimeException error) { UbuntuDistributionInstaller.recordInstallError(context, error); }
        }
    }

    static synchronized void recover(Context context, UbuntuDistributionInstaller installer, SandboxJobStore store) throws Exception {
        if (installer.isReady()) return;
        String error = UbuntuDistributionInstaller.lastInstallError(context);
        if (error != null && !FOREGROUND_REQUIRED.equals(error)) return;
        String id = prefs(context).getString(REQUEST, null);
        if (id == null || REMOVED.equals(id)) return;
        SandboxJobStore.Job job = setupJob(context, installer, store);
        if (job != null && !SandboxJobStore.STATE_QUEUED.equals(job.state)) return;
        if (installer.isInstalled()) {
            startConfiguration(context, store, id, job);
            UbuntuDistributionInstaller.recordInstallError(context, null);
        } else {
            String download = installer.downloadState();
            if ("completed".equals(download)) enqueue(context, id);
            else if ("not_downloaded".equals(download)) installer.enqueueDownload();
        }
    }

    static synchronized void remove(Context context, UbuntuDistributionInstaller installer, SandboxJobStore store) throws Exception {
        // Persist the tombstone before cancellation so a late completion cannot recreate the rootfs.
        saveId(context, REMOVED);
        WorkManager.getInstance(context).cancelAllWorkByTag(UNIQUE_WORK);
        for (SandboxJobStore.Job job : store.list()) {
            if (UbuntuDistribution.RUNTIME_ID.equals(job.runtimeId) && active(job)) {
                store.update(job.id, SandboxJobStore.STATE_CANCELLED, job.pid, 130, System.currentTimeMillis());
                YachiyoSandboxService.stop(context, job.id);
            }
        }
        installer.remove();
        UbuntuDistributionInstaller.recordInstallError(context, null);
    }

    @NonNull @Override public Result doWork() {
        Context context = getApplicationContext();
        synchronized (UbuntuInstallWorker.class) {
            try {
                UbuntuDistribution.Spec spec = UbuntuDistribution.current(context.getApplicationInfo().nativeLibraryDir);
                if (spec == null) return Result.failure();
                UbuntuDistributionInstaller installer = new UbuntuDistributionInstaller(context, spec);
                if (isStopped() || installer.isReady()) return Result.success();
                String expected = getInputData().getString(REQUEST);
                String id = prefs(context).getString(REQUEST, null);
                if (expected == null && id == null) {
                    // A worker already queued by the previous APK carries no request ID.
                    if (!installer.isInstalled() && "not_downloaded".equals(installer.downloadState())) return Result.success();
                    SandboxJobStore.Job legacy = setupJob(context, installer, new SandboxJobStore(context));
                    id = legacy == null ? "job_" + UUID.randomUUID().toString().replace("-", "") : legacy.id;
                    saveId(context, id);
                } else if (expected == null || !expected.equals(id)) return Result.success();
                if (REMOVED.equals(id) || UbuntuDistributionInstaller.lastInstallError(context) != null) return Result.success();
                if (!installer.isInstalled()) {
                    if (!"completed".equals(installer.downloadState())) return Result.success();
                    extractingJobId = id;
                    try { installer.installDownloaded((stage, percent, transferred, total) -> {}); }
                    finally { extractingJobId = null; }
                }
                if (isStopped()) return Result.success();
                SandboxJobStore store = new SandboxJobStore(context);
                startConfiguration(context, store, id, setupJob(context, installer, store));
                return Result.success();
            } catch (Exception error) {
                UbuntuDistributionInstaller.recordInstallError(context, error);
                return Result.failure();
            }
        }
    }

    private static File pluginWorkspace(Context context) throws Exception {
        byte[] hash = java.security.MessageDigest.getInstance("SHA-256")
            .digest("plugin:ubuntu-runtime".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        StringBuilder id = new StringBuilder();
        for (int index = 0; index < 8; index++) id.append(String.format("%02x", hash[index]));
        return new File(context.getFilesDir(), "linux-sandbox/workspaces/" + id);
    }
}
