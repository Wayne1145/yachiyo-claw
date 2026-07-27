package io.github.yachiyoclaw;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class NativeCallValuesTest {
    @Test
    public void acceptsAllNumericRepresentationsUsedByTheJavascriptBridge() {
        assertEquals(18_428L, NativeCallValues.coerceLong(Integer.valueOf(18_428), 0L));
        assertEquals(5_990_332L, NativeCallValues.coerceLong(Long.valueOf(5_990_332L), 0L));
        assertEquals(350L, NativeCallValues.coerceLong(Double.valueOf(350.0), 0L));
    }

    @Test
    public void rejectsNonNumericValues() {
        assertEquals(7L, NativeCallValues.coerceLong("7", 7L));
        assertEquals(7L, NativeCallValues.coerceLong(null, 7L));
    }
}
