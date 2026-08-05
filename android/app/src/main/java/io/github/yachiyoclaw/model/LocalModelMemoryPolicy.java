package io.github.yachiyoclaw.model;

/** Pure memory admission policy. mmap inference is allowed independently from full weight preloading. */
final class LocalModelMemoryPolicy {
    private static final long MIB = 1024L * 1024L;

    record Decision(boolean runnable, boolean eager, long runtimeBytes, long eagerBytes, long systemReserveBytes) {}

    private LocalModelMemoryPolicy() {}

    static Decision decide(long totalRamBytes, long availableRamBytes, long modelBytes, boolean eagerRequested) {
        if (availableRamBytes < 0 || modelBytes <= 0) return new Decision(false, false, 0L, 0L, 0L);
        long reserve = AccelerationPolicy.requiredSystemHeadroom(totalRamBytes);
        // mmap keeps model pages evictable. This budget covers native metadata, a bounded KV cache,
        // token buffers, and the isolated service process without pretending every file byte is resident.
        long runtime = Math.max(512L * MIB, Math.addExact(384L * MIB, modelBytes / 16L));
        boolean runnable = AccelerationPolicy.hasInferenceHeadroom(totalRamBytes, availableRamBytes, runtime);
        long eagerBytes = saturatedAdd(modelBytes, runtime);
        boolean eager = eagerRequested
            && runnable
            && AccelerationPolicy.hasInferenceHeadroom(totalRamBytes, availableRamBytes, eagerBytes);
        return new Decision(runnable, eager, runtime, eagerBytes, reserve);
    }

    private static long saturatedAdd(long left, long right) {
        if (right > 0 && left > Long.MAX_VALUE - right) return Long.MAX_VALUE;
        return left + right;
    }
}
