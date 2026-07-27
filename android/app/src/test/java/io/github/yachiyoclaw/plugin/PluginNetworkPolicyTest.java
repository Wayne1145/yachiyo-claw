package io.github.yachiyoclaw.plugin;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.net.InetAddress;
import java.net.Inet6Address;
import java.util.List;
import org.junit.Test;

public final class PluginNetworkPolicyTest {
    @Test
    public void rejectsPrivateAndLoopbackAddresses() throws Exception {
        assertFalse(PluginNetworkPolicy.isPublicAddress(InetAddress.getByName("127.0.0.1")));
        assertFalse(PluginNetworkPolicy.isPublicAddress(InetAddress.getByName("10.0.0.1")));
        assertFalse(PluginNetworkPolicy.isPublicAddress(InetAddress.getByName("192.168.1.1")));
        assertFalse(PluginNetworkPolicy.isPublicAddress(InetAddress.getByName("100.64.0.1")));
        assertFalse(PluginNetworkPolicy.isPublicAddress(InetAddress.getByName("fd00::1")));
        byte[] mappedLoopback = new byte[16];
        mappedLoopback[10] = (byte) 0xff;
        mappedLoopback[11] = (byte) 0xff;
        mappedLoopback[12] = 127;
        mappedLoopback[15] = 1;
        assertFalse(PluginNetworkPolicy.isPublicAddress(Inet6Address.getByAddress(null, mappedLoopback, -1)));
        assertTrue(PluginNetworkPolicy.isPublicAddress(InetAddress.getByName("8.8.8.8")));
    }

    @Test
    public void resolvesAndPinsOnlyPublicAddresses() throws Exception {
        InetAddress publicAddress = InetAddress.getByAddress("api.example.com", new byte[] {8, 8, 8, 8});
        PluginNetworkPolicy.ResolvedUri resolved = PluginNetworkPolicy.resolveAllowedPublicHttps(
            "https://api.example.com/v1",
            List.of("api.example.com"),
            host -> new InetAddress[] {publicAddress}
        );

        assertEquals("api.example.com", resolved.uri.getHost());
        assertEquals(List.of(publicAddress), resolved.addresses);
        assertThrows(
            UnsupportedOperationException.class,
            () -> resolved.addresses.add(publicAddress)
        );
    }

    @Test
    public void rejectsAResolutionSetContainingAnyPrivateAddress() throws Exception {
        InetAddress publicAddress = InetAddress.getByAddress(new byte[] {8, 8, 8, 8});
        InetAddress privateAddress = InetAddress.getByAddress(new byte[] {10, 0, 0, 1});
        assertThrows(
            SecurityException.class,
            () -> PluginNetworkPolicy.resolveAllowedPublicHttps(
                "https://api.example.com/v1",
                List.of("api.example.com"),
                host -> new InetAddress[] {publicAddress, privateAddress}
            )
        );
    }
}
