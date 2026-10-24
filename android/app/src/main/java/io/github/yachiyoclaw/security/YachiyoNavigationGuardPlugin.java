package io.github.yachiyoclaw.security;

import android.net.Uri;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "YachiyoNavigationGuard")
public final class YachiyoNavigationGuardPlugin extends Plugin {
    @Override
    public Boolean shouldOverrideLoad(Uri url) {
        // Upstream workaround: never load the native HTTP proxy as an app-origin document.
        // Uri.getPath() decodes escapes; null leaves all other navigation to Capacitor's policy.
        return url != null && CapacitorNavigationPolicy.blocksDocumentPath(url.getPath()) ? Boolean.TRUE : null;
    }
}
