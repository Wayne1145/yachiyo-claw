package io.github.yachiyoclaw;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import io.github.yachiyoclaw.agent.YachiyoAgentPlugin;
import io.github.yachiyoclaw.agent.YachiyoDeviceAccessPlugin;
import io.github.yachiyoclaw.security.YachiyoSecureStoragePlugin;
import io.github.yachiyoclaw.media.YachiyoVoicePlugin;
import io.github.yachiyoclaw.scheduler.YachiyoSchedulerPlugin;
import io.github.yachiyoclaw.memory.YachiyoMemoryPlugin;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(YachiyoSecureStoragePlugin.class);
        registerPlugin(YachiyoAgentPlugin.class);
        registerPlugin(YachiyoDeviceAccessPlugin.class);
        registerPlugin(YachiyoVoicePlugin.class);
        registerPlugin(YachiyoSchedulerPlugin.class);
        registerPlugin(YachiyoMemoryPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
