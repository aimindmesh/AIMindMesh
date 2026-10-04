package com.aimindmesh.mobile.performance

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PowerUnitsTest {
    @Test
    fun readsMicroampsAndMilliampsWithEitherSign() {
        assertEquals(850.0, PowerUnits.currentMa(-850_000L)!!, 0.001) // µA, discharging (AOSP sign)
        assertEquals(850.0, PowerUnits.currentMa(850_000L)!!, 0.001)  // µA, vendor sign
        assertEquals(850.0, PowerUnits.currentMa(-850L)!!, 0.001)     // mA (some vendors)
        assertNull(PowerUnits.currentMa(Long.MIN_VALUE))              // not supported
        assertNull(PowerUnits.currentMa(0L))
    }

    @Test
    fun powerOnlyWhileOnBattery() {
        assertEquals(3400.0, PowerUnits.dischargeMw(-850_000L, 4000, charging = false)!!, 0.001)
        assertNull(PowerUnits.dischargeMw(-850_000L, 4000, charging = true))
        assertNull(PowerUnits.dischargeMw(-850_000L, -1, charging = false))
    }
}
