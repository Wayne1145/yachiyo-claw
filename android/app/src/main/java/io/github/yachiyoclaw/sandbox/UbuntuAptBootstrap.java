package io.github.yachiyoclaw.sandbox;

import java.io.IOException;
import java.net.URI;
import java.security.KeyStore;
import java.security.cert.Certificate;
import java.util.Base64;
import java.util.Enumeration;

/** Configuration used only while provisioning an Ubuntu Base guest. */
final class UbuntuAptBootstrap {
    private UbuntuAptBootstrap() {}

    static String sources(String architecture, boolean mirror) {
        boolean ports = architecture.equals("arm64");
        String origin = mirror ? "https://mirrors.tuna.tsinghua.edu.cn/" + (ports ? "ubuntu-ports" : "ubuntu")
            : ports ? "https://ports.ubuntu.com/ubuntu-ports" : "https://archive.ubuntu.com/ubuntu";
        String security = ports || mirror ? origin : "https://security.ubuntu.com/ubuntu";
        return stanza(origin, "noble noble-updates") + "\n" + stanza(security, "noble-security");
    }

    private static String stanza(String origin, String suites) {
        return "Types: deb\nURIs: " + origin + "\nSuites: " + suites + "\nComponents: main universe\n" +
            "Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n";
    }

    static String aptConfig(String proxy) throws IOException {
        String config = "Acquire::https::CaInfo \"/etc/apt/yachiyo-bootstrap-ca.pem\";\n" +
            "Acquire::Retries \"3\";\nAcquire::https::Timeout \"40\";\n";
        if (proxy.isEmpty()) return config;
        // APT reads configuration syntax. Only render validated host/port components from user settings.
        try {
            URI uri = new URI(proxy);
            String host = uri.getHost();
            String path = uri.getRawPath();
            if (host == null || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null ||
                (path != null && !path.isEmpty()) || uri.getPort() == 0 || uri.getPort() > 65535 ||
                !("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))) {
                throw new IOException("ubuntu_proxy_invalid");
            }
            String endpoint = uri.getScheme() + "://" + host + (uri.getPort() < 0 ? "" : ":" + uri.getPort());
            return config + "Acquire::http::Proxy \"" + endpoint + "\";\nAcquire::https::Proxy \"" + endpoint + "\";\n";
        } catch (java.net.URISyntaxException e) { throw new IOException("ubuntu_proxy_invalid", e); }
    }

    static String androidSystemRoots() throws Exception {
        KeyStore ca = KeyStore.getInstance("AndroidCAStore");
        ca.load(null);
        Enumeration<String> names = ca.aliases();
        StringBuilder pem = new StringBuilder();
        Base64.Encoder encoder = Base64.getMimeEncoder(64, new byte[]{'\n'});
        while (names.hasMoreElements()) {
            String name = names.nextElement();
            if (!name.startsWith("system:")) continue;
            Certificate certificate = ca.getCertificate(name);
            if (certificate != null) pem.append("-----BEGIN CERTIFICATE-----\n")
                .append(encoder.encodeToString(certificate.getEncoded())).append("\n-----END CERTIFICATE-----\n");
        }
        if (pem.length() == 0) throw new IOException("ubuntu_system_ca_unavailable");
        return pem.toString();
    }

    static String command() {
        // The first apt update needs trust anchors before the guest can install ca-certificates.
        // Keep the bootstrap proxy and trust bundle private to these APT invocations.
        return "set -eu; export DEBIAN_FRONTEND=noninteractive; " +
            "apt_bootstrap() { apt-get -c /etc/apt/yachiyo-bootstrap.conf -o Dpkg::Use-Pty=0 \"$@\"; }; " +
            "apt_bootstrap -o APT::Update::Error-Mode=any update; " +
            "dpkg --configure -a; apt_bootstrap install -y --no-install-recommends " +
            "bash ca-certificates curl wget git openssh-client python3 python3-pip python3-venv " +
            "nodejs npm build-essential cmake ninja-build pkg-config unzip zip jq ripgrep; " +
            "apt-get clean; python3 --version; node --version; npm --version; git --version; " +
            "touch /.yachiyo-toolchain-v1";
    }
}
