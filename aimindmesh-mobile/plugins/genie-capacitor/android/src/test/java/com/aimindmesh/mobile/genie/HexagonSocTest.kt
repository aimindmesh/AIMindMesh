package com.aimindmesh.mobile.genie

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HexagonSocTest {
    @Test
    fun recognizesBothFolds() {
        assertEquals("v73", HexagonSoc.arch("SM8550", "kalama", "qcom")) // Fold5
        assertEquals("v79", HexagonSoc.arch("SM8750", "sun", "qcom"))    // Fold7
        assertEquals("v79", HexagonSoc.arch("", "sun", "qcom"))          // before Android 12, no SOC_MODEL
        assertEquals("v75", HexagonSoc.arch("SM8650", "pineapple", "qcom"))
        assertEquals("none", HexagonSoc.arch("Tensor G4", "caiman", "caiman"))
    }

    @Test
    fun qairtBundlesOnlyOnTheEliteGenerations() {
        assertTrue(HexagonSoc.qairtSupported("v79"))
        assertFalse(HexagonSoc.qairtSupported("v73"))
    }
}
