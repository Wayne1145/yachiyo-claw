package io.github.yachiyoclaw.plugin;

import java.net.InetAddress;
import java.net.URI;
import java.util.HashSet;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Native-side SSRF boundary for third-party plugin egress. */
final class PluginNetworkPolicy {
    private PluginNetworkPolicy() {}

    interface AddressResolver {
        InetAddress[] resolve(String host) throws Exception;
    }

    static final class ResolvedUri {
        final URI uri;
        final List<InetAddress> addresses;

        ResolvedUri(URI uri, List<InetAddress> addresses) {
            this.uri = uri;
            this.addresses = Collections.unmodifiableList(addresses);
        }
    }

    static URI requireAllowedPublicHttps(String value, List<String> allowedDomains) throws Exception {
        return resolveAllowedPublicHttps(value, allowedDomains).uri;
    }

    static ResolvedUri resolveAllowedPublicHttps(String value, List<String> allowedDomains) throws Exception {
        return resolveAllowedPublicHttps(value, allowedDomains, InetAddress::getAllByName);
    }

    static ResolvedUri resolveAllowedPublicHttps(
        String value,
        List<String> allowedDomains,
        AddressResolver resolver
    ) throws Exception {
        URI uri = new URI(value);
        String host = uri.getHost();
        if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null || host.isBlank() || uri.getRawUserInfo() != null) {
            throw new SecurityException("plugin_network_invalid_url");
        }
        String normalized = host.toLowerCase(Locale.ROOT);
        Set<String> allowed = new HashSet<>();
        for (String domain : allowedDomains) if (domain != null) allowed.add(domain.trim().toLowerCase(Locale.ROOT));
        if (!allowed.contains(normalized)) throw new SecurityException("plugin_network_domain_denied");
        InetAddress[] resolved = resolver.resolve(host);
        if (resolved.length == 0) throw new SecurityException("plugin_network_dns_empty");
        for (InetAddress address : resolved) {
            if (!isPublicAddress(address)) throw new SecurityException("plugin_network_private_address_denied");
        }
        return new ResolvedUri(uri, Arrays.asList(resolved.clone()));
    }

    static boolean isPublicAddress(InetAddress address) {
        byte[] raw = address.getAddress();
        boolean uniqueLocalV6 = raw.length == 16 && (raw[0] & 0xfe) == 0xfc;
        boolean mappedV4 = raw.length == 16;
        if (mappedV4) {
            for (int index = 0; index < 10; index++) mappedV4 &= raw[index] == 0;
            mappedV4 &= (raw[10] & 0xff) == 0xff && (raw[11] & 0xff) == 0xff;
        }
        boolean specialV4 = raw.length == 4 ? isSpecialV4(raw, 0) : mappedV4 && isSpecialV4(raw, 12);
        return !uniqueLocalV6
            && !specialV4
            && !address.isAnyLocalAddress()
            && !address.isLoopbackAddress()
            && !address.isLinkLocalAddress()
            && !address.isSiteLocalAddress()
            && !address.isMulticastAddress();
    }

    private static boolean isSpecialV4(byte[] raw, int offset) {
        int first = raw[offset] & 0xff;
        int second = raw[offset + 1] & 0xff;
        return first == 0 ||
            first == 10 ||
            first == 127 ||
            first >= 224 ||
            (first == 100 && second >= 64 && second <= 127) ||
            (first == 169 && second == 254) ||
            (first == 172 && second >= 16 && second <= 31) ||
            (first == 192 && second == 168) ||
            (first == 198 && (second == 18 || second == 19));
    }
}
