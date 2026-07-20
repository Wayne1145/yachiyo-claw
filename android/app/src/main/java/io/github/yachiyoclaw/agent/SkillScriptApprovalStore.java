package io.github.yachiyoclaw.agent;

import java.security.SecureRandom;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;

/** Process-local, single-use grants bind native execution to one approved parameter set. */
final class SkillScriptApprovalStore {
    private static final long TTL_MS = 30_000L;
    private static final int MAX_GRANTS = 64;
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Map<String, Grant> GRANTS = new LinkedHashMap<>();

    private SkillScriptApprovalStore() {}

    static synchronized Approval issue(String parameterDigest) {
        pruneExpired();
        while (GRANTS.size() >= MAX_GRANTS) {
            Iterator<String> iterator = GRANTS.keySet().iterator();
            if (!iterator.hasNext()) break;
            iterator.next();
            iterator.remove();
        }
        byte[] tokenBytes = new byte[32];
        RANDOM.nextBytes(tokenBytes);
        StringBuilder tokenBuilder = new StringBuilder(64);
        for (byte value : tokenBytes) tokenBuilder.append(String.format(java.util.Locale.ROOT, "%02x", value & 0xff));
        String token = tokenBuilder.toString();
        long expiresAt = System.currentTimeMillis() + TTL_MS;
        GRANTS.put(token, new Grant(parameterDigest, expiresAt));
        return new Approval(token, expiresAt);
    }

    static synchronized boolean consume(String token, String parameterDigest) {
        pruneExpired();
        if (token == null || token.isEmpty()) return false;
        Grant grant = GRANTS.remove(token);
        return grant != null && grant.expiresAt >= System.currentTimeMillis() && grant.parameterDigest.equals(parameterDigest);
    }

    static synchronized void clearForTests() {
        GRANTS.clear();
    }

    private static void pruneExpired() {
        long now = System.currentTimeMillis();
        GRANTS.values().removeIf(grant -> grant.expiresAt < now);
    }

    static final class Approval {
        final String nonce;
        final long expiresAt;

        Approval(String nonce, long expiresAt) {
            this.nonce = nonce;
            this.expiresAt = expiresAt;
        }
    }

    private static final class Grant {
        final String parameterDigest;
        final long expiresAt;

        Grant(String parameterDigest, long expiresAt) {
            this.parameterDigest = parameterDigest;
            this.expiresAt = expiresAt;
        }
    }
}
