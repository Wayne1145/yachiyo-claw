package io.github.yachiyoclaw.sandbox;

import static org.junit.Assert.*;

import android.content.ComponentName;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.Intent;
import android.content.SharedPreferences;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.file.Files;
import java.util.UUID;
import org.junit.Test;

/** Exercises durable install identity against Android preferences, Keystore and the sandbox job registry. */
public class UbuntuInstallLifecycleTest {
    @Test public void repeatedInstallReusesJobAndFailedAptCanBeExplicitlyRetried() throws Exception {
        Context target = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File files = Files.createTempDirectory(target.getCacheDir().toPath(), "ubuntu-install-test-").toFile();
        String prefix = "ubuntu-test-" + UUID.randomUUID() + "-";
        Context isolated = new ContextWrapper(target) {
            @Override public Context getApplicationContext() { return this; }
            @Override public File getFilesDir() { return files; }
            @Override public SharedPreferences getSharedPreferences(String name, int mode) {
                return super.getSharedPreferences(prefix + name, mode);
            }
            @Override public ComponentName startForegroundService(Intent service) {
                return service.getComponent(); // This test drives job outcomes without launching a real package manager.
            }
        };
        try {
            UbuntuDistribution.Spec spec = UbuntuDistribution.forAbi("x86_64");
            UbuntuDistributionInstaller installer = new UbuntuDistributionInstaller(isolated, spec);
            File rootfs = installer.rootfsDirectory();
            Files.createDirectories(new File(rootfs, "bin").toPath());
            Files.createFile(new File(rootfs, "bin/bash").toPath());
            Files.createFile(new File(rootfs, ".yachiyo-rootfs-" + UbuntuDistribution.VERSION).toPath());
            SandboxJobStore store = new SandboxJobStore(isolated);

            String first = UbuntuInstallWorker.request(isolated, installer, store).jobId();
            String workspace = store.get(first).workspace;
            store.create("job_unrelated", "printf preflight", workspace, 3_600_000, 100L, UbuntuDistribution.RUNTIME_ID);
            assertEquals(first, UbuntuInstallWorker.request(isolated, installer, new SandboxJobStore(isolated)).jobId());
            assertEquals(2, store.list().size());

            // Simulate an APK upgrade from before the dedicated job ID was persisted.
            assertTrue(isolated.getSharedPreferences("ubuntu-install", Context.MODE_PRIVATE).edit().clear().commit());
            store.update(first, SandboxJobStore.STATE_FAILED, 0, 100, System.currentTimeMillis());
            UbuntuInstallWorker.Status failed = UbuntuInstallWorker.status(isolated, installer, store);
            assertEquals(first, failed.jobId());
            assertEquals("failed", failed.state());
            assertEquals("ubuntu_configuration_exit_100", failed.error());
            String retry = UbuntuInstallWorker.request(isolated, installer, store).jobId();
            assertNotEquals(first, retry);
            assertEquals(retry, UbuntuInstallWorker.request(isolated, installer, store).jobId());
            assertEquals(3, store.list().size());
            assertEquals(SandboxJobStore.STATE_QUEUED, store.get("job_unrelated").state);
            Files.createFile(installer.toolchainMarker().toPath());
            assertEquals("ready", UbuntuInstallWorker.status(isolated, installer, store).state());
        } finally {
            target.deleteSharedPreferences(prefix + "ubuntu-install");
            AlpineSandboxInstaller.deleteRecursively(files);
        }
    }
}
