package io.github.yachiyoclaw.sandbox;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.BackoffPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.File;
import java.util.concurrent.TimeUnit;

/** Continues Ubuntu extraction and toolchain setup after the persistent rootfs download completes. */
public final class UbuntuInstallWorker extends Worker {
    private static final String UNIQUE_WORK = "yachiyo-ubuntu-24.04-install";

    public UbuntuInstallWorker(@NonNull Context context, @NonNull WorkerParameters parameters) {
        super(context, parameters);
    }

    static void enqueue(Context context) {
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(UbuntuInstallWorker.class)
            .setBackoffCriteria(BackoffPolicy.LINEAR, 10, TimeUnit.SECONDS)
            .addTag(UNIQUE_WORK)
            .build();
        WorkManager.getInstance(context).enqueueUniqueWork(UNIQUE_WORK, ExistingWorkPolicy.KEEP, request);
    }

    @NonNull @Override public Result doWork() {
        try {
            UbuntuDistribution.Spec distribution = UbuntuDistribution.current(getApplicationContext().getApplicationInfo().nativeLibraryDir);
            if (distribution == null) return Result.failure();
            UbuntuDistributionInstaller installer = new UbuntuDistributionInstaller(getApplicationContext(), distribution);
            if (installer.isReady()) return Result.success();
            if (!installer.isInstalled()) {
                String state = installer.downloadState();
                if ("failed".equals(state) || "cancelled".equals(state)) return Result.failure();
                if (!"completed".equals(state)) return Result.retry();
                installer.installDownloaded((stage, percent, transferred, total) -> {});
            }
            SandboxJobStore store = new SandboxJobStore(getApplicationContext());
            store.reconcile(System.currentTimeMillis());
            for (SandboxJobStore.Job job : store.list()) {
                if (!UbuntuDistribution.RUNTIME_ID.equals(job.runtimeId)) continue;
                if (SandboxJobStore.STATE_QUEUED.equals(job.state)) {
                    YachiyoSandboxService.start(getApplicationContext(), job.id);
                    return Result.success();
                }
                if (SandboxJobStore.STATE_RUNNING.equals(job.state)) return Result.success();
            }
            File workspace = pluginWorkspace(getApplicationContext());
            if (!workspace.isDirectory() && !workspace.mkdirs()) return Result.failure();
            String jobId = "job_" + java.util.UUID.randomUUID().toString().replace("-", "");
            store.create(
                jobId,
                toolchainInstallCommand(),
                workspace.getCanonicalPath(),
                3_600_000,
                System.currentTimeMillis(),
                UbuntuDistribution.RUNTIME_ID
            );
            YachiyoSandboxService.start(getApplicationContext(), jobId);
            return Result.success();
        } catch (Exception error) {
            return getRunAttemptCount() < 20 ? Result.retry() : Result.failure();
        }
    }

    static String toolchainInstallCommand() {
        return "set -eu; export DEBIAN_FRONTEND=noninteractive; " +
            "apt-get update; apt-get install -y --no-install-recommends " +
            "bash ca-certificates curl wget git openssh-client python3 python3-pip python3-venv " +
            "nodejs npm build-essential cmake ninja-build pkg-config unzip zip jq ripgrep; " +
            "apt-get clean; rm -rf /var/lib/apt/lists/*; " +
            "python3 --version; node --version; npm --version; git --version; touch /.yachiyo-toolchain-v1";
    }

    private static File pluginWorkspace(Context context) throws Exception {
        byte[] hash = java.security.MessageDigest.getInstance("SHA-256")
            .digest("plugin:ubuntu-runtime".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        StringBuilder id = new StringBuilder();
        for (int index = 0; index < 8; index++) id.append(String.format("%02x", hash[index]));
        return new File(context.getFilesDir(), "linux-sandbox/workspaces/" + id);
    }
}
