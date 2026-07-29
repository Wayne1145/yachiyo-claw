package io.github.yachiyoclaw.model;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;
import java.util.List;

public final class AccelerationRuntimeSupportTest {
    @Test public void requiresExactSocTokenInNpuArtifactName() {
        assertTrue(AccelerationRuntimeSupport.modelMatchesSoc(
            "/models/Gemma3-1B_q4_SM8650.litertlm", "Qualcomm SM8650"));
        assertFalse(AccelerationRuntimeSupport.modelMatchesSoc(
            "/models/Gemma3-1B_generic.litertlm", "Qualcomm SM8650"));
        assertFalse(AccelerationRuntimeSupport.modelMatchesSoc(
            "/models/Gemma3-1B_dimensity9300.litertlm", "Qualcomm SM8650"));
    }

    @Test public void matchesOnlyDeclaredSocAndVendorFamilies() {
        assertTrue(AccelerationRuntimeSupport.declaredSocMatches(List.of("SM8650"), "Qualcomm SM8650"));
        assertFalse(AccelerationRuntimeSupport.declaredSocMatches(List.of("SM8550"), "Qualcomm SM8650"));
        assertTrue(AccelerationRuntimeSupport.declaredVendorMatches("qualcomm", "QTI SM8650"));
        assertTrue(AccelerationRuntimeSupport.declaredVendorMatches("mediatek", "MediaTek Dimensity 9300"));
        assertFalse(AccelerationRuntimeSupport.declaredVendorMatches("mediatek", "Qualcomm SM8650"));
    }
}
