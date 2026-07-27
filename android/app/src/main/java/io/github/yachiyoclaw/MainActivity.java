package io.github.yachiyoclaw;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import io.github.yachiyoclaw.agent.YachiyoAgentPlugin;
import io.github.yachiyoclaw.agent.YachiyoDeviceAccessPlugin;
import io.github.yachiyoclaw.security.YachiyoSecureStoragePlugin;
import io.github.yachiyoclaw.media.YachiyoVoicePlugin;
import io.github.yachiyoclaw.scheduler.YachiyoSchedulerPlugin;
import io.github.yachiyoclaw.memory.YachiyoMemoryPlugin;
import io.github.yachiyoclaw.update.YachiyoUpdatePlugin;
import io.github.yachiyoclaw.model.YachiyoModelManagerPlugin;
import io.github.yachiyoclaw.sandbox.YachiyoSandboxPlugin;
import io.github.yachiyoclaw.workspace.YachiyoWorkspacePlugin;
import io.github.yachiyoclaw.download.YachiyoDownloadSettingsPlugin;
import io.github.yachiyoclaw.plugin.YachiyoPluginNetworkPlugin;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(YachiyoSecureStoragePlugin.class);
        registerPlugin(YachiyoAgentPlugin.class);
        registerPlugin(YachiyoDeviceAccessPlugin.class);
        registerPlugin(YachiyoVoicePlugin.class);
        registerPlugin(YachiyoSchedulerPlugin.class);
        registerPlugin(YachiyoMemoryPlugin.class);
        registerPlugin(YachiyoUpdatePlugin.class);
        registerPlugin(YachiyoModelManagerPlugin.class);
        registerPlugin(YachiyoSandboxPlugin.class);
        registerPlugin(YachiyoWorkspacePlugin.class);
        registerPlugin(YachiyoDownloadSettingsPlugin.class);
        registerPlugin(YachiyoPluginNetworkPlugin.class);
        super.onCreate(savedInstanceState);
        handleNavigationIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleNavigationIntent(intent);
    }

    // A download notification carries openDownloads; the webview picks it up via consumePendingRoute.
    private void handleNavigationIntent(Intent intent) {
        if (intent != null && intent.getBooleanExtra("openDownloads", false)) {
            YachiyoDownloadSettingsPlugin.setPendingRoute(this, "downloads");
            if (bridge != null && bridge.getPlugin("YachiyoDownloads") != null
                && bridge.getPlugin("YachiyoDownloads").getInstance() instanceof YachiyoDownloadSettingsPlugin downloads) {
                downloads.emitPendingRoute("downloads");
            }
        }
    }
}
