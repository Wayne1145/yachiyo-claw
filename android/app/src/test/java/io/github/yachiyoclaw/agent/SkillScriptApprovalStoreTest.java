package io.github.yachiyoclaw.agent;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.After;
import org.junit.Test;

public class SkillScriptApprovalStoreTest {

    @After
    public void clear() {
        SkillScriptApprovalStore.clearForTests();
    }

    @Test
    public void approvalIsSingleUseAndParameterBound() {
        SkillScriptApprovalStore.Approval approval = SkillScriptApprovalStore.issue("digest-one");
        assertFalse(SkillScriptApprovalStore.consume(approval.nonce, "digest-two"));
        assertFalse(SkillScriptApprovalStore.consume(approval.nonce, "digest-one"));

        SkillScriptApprovalStore.Approval matching = SkillScriptApprovalStore.issue("digest-one");
        assertTrue(SkillScriptApprovalStore.consume(matching.nonce, "digest-one"));
        assertFalse(SkillScriptApprovalStore.consume(matching.nonce, "digest-one"));
    }
}
