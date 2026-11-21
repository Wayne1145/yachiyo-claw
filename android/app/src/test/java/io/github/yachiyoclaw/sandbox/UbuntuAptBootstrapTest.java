package io.github.yachiyoclaw.sandbox;

import static org.junit.Assert.*;
import java.io.IOException;
import org.junit.Test;

public class UbuntuAptBootstrapTest {
    @Test public void selectsSignedRepositoryForGuestArchitecture() {
        assertTrue(UbuntuAptBootstrap.sources("arm64", true).contains("tuna.tsinghua.edu.cn/ubuntu-ports"));
        assertTrue(UbuntuAptBootstrap.sources("amd64", false).contains("security.ubuntu.com/ubuntu"));
        assertTrue(UbuntuAptBootstrap.sources("amd64", true).contains("Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg"));
    }

    @Test public void requiresTlsRootsEvenBeforeGuestCertificatesAreInstalled() throws Exception {
        String config = UbuntuAptBootstrap.aptConfig("");
        assertTrue(config.contains("Acquire::https::CaInfo"));
        assertFalse(config.contains("Proxy"));
        assertTrue(UbuntuAptBootstrap.command().contains("APT::Update::Error-Mode=any"));
    }

    @Test public void proxyIsAppliedToAptAndCannotInjectConfig() throws Exception {
        assertTrue(UbuntuAptBootstrap.aptConfig("http://127.0.0.1:7890").contains("Acquire::https::Proxy \"http://127.0.0.1:7890\""));
        assertThrows(IOException.class, () -> UbuntuAptBootstrap.aptConfig("http://user:pass@host:90"));
        assertThrows(IOException.class, () -> UbuntuAptBootstrap.aptConfig("http://host:90/\";Other=1"));
    }
}
