package io.github.yachiyoclaw.sandbox;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import java.io.File;
import java.io.FileOutputStream;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Collections;
import java.util.List;

/** Keeps guest resolv.conf in sync with the device's live DNS configuration.
 *  A hardcoded public resolver is unreachable in many real networks, which
 *  silently stalls every guest apt/curl call until timeout. */
final class GuestDns {
    private GuestDns() {}

    static void sync(Context context, File rootfs) throws Exception {
        ConnectivityManager manager = context.getSystemService(ConnectivityManager.class);
        Network activeNetwork = manager == null ? null : manager.getActiveNetwork();
        LinkProperties properties = manager == null || activeNetwork == null ? null : manager.getLinkProperties(activeNetwork);
        List<InetAddress> servers = properties == null ? Collections.emptyList() : properties.getDnsServers();
        StringBuilder content = new StringBuilder();
        for (InetAddress server : servers) {
            String address = server.getHostAddress();
            if (address != null && !address.trim().isEmpty() && address.indexOf('%') < 0) {
                content.append("nameserver ").append(address).append('\n');
            }
        }
        if (content.length() == 0) {
            // Fallback resolvers must be reachable from typical CN networks too.
            content.append("nameserver 223.5.5.5\nnameserver 119.29.29.29\n");
        }
        File resolv = new File(rootfs, "etc/resolv.conf");
        File parent = resolv.getParentFile();
        if (parent == null || (!parent.isDirectory() && !parent.mkdirs())) return;
        if (Files.isSymbolicLink(resolv.toPath())) Files.delete(resolv.toPath());
        try (FileOutputStream output = new FileOutputStream(resolv)) {
            output.write(content.toString().getBytes(StandardCharsets.US_ASCII));
            output.getFD().sync();
        }
    }
}
