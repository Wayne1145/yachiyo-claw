package io.github.yachiyoclaw;

import com.getcapacitor.PluginCall;

/** Numeric bridge values may arrive as Integer, Long, or Double depending on their JS magnitude. */
public final class NativeCallValues {
    private NativeCallValues() {}

    public static long getLong(PluginCall call, String name, long defaultValue) {
        return coerceLong(call.getData().opt(name), defaultValue);
    }

    static long coerceLong(Object value, long defaultValue) {
        return value instanceof Number ? ((Number) value).longValue() : defaultValue;
    }
}
