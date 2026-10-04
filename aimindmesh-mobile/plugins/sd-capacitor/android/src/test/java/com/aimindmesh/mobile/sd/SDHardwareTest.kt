package com.aimindmesh.mobile.sd

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SDHardwareTest {
    @Test
    fun recognizesTheHexagonVersionOfThePhone() {
        assertEquals("v79", HexagonArch.forDevice("SM8750", "sun", "qcom"))      // Z Fold7
        assertEquals("v73", HexagonArch.forDevice("SM8550", "kalama", "qcom"))   // Z Fold5
        assertEquals("v75", HexagonArch.forDevice("", "pineapple", "qcom"))      // Android < 12: no SOC_MODEL
        assertEquals("v81", HexagonArch.forDevice("SM8850", "canoe", "qcom"))
        assertEquals("v79", HexagonArch.forDevice("SM8750-AC", "", "qcom"))
        assertNull(HexagonArch.forDevice("SM7550", "crow", "qcom"))              // not in the list: no NPU path
        assertNull(HexagonArch.forDevice("Tensor G4", "caiman", "caiman"))
        assertEquals("libQnnHtpV73Stub.so", HexagonArch.stubLibrary("v73"))
    }

    @Test
    fun readsTheTargetOfAPackage() {
        // our exports (scripts/export_uberrealistic.py)
        assertEquals("v73", HexagonArch.forPackage("""{"hexagon": "v73", "prediction_type": "v_prediction"}"""))
        // Qualcomm AI Hub packages
        assertEquals("v79", HexagonArch.forPackage("""{"model_id": "stable_diffusion_v2_1", "chipset_attributes": {"htp_version": 79}}"""))
        assertNull(HexagonArch.forPackage("""{"model_name": "old export"}"""))
        assertNull(HexagonArch.forPackage("""{"hexagon": "fast"}"""))
    }

    @Test
    fun refusesPackagesForAnotherNpu() {
        val error = HexagonArch.incompatibility("v79", "v73")!!
        assertTrue(error, error.contains("Hexagon v79 NPU (Snapdragon 8 Elite)"))
        assertTrue(error, error.contains("this phone has v73 (Snapdragon 8 Gen 2)"))
        assertNull(HexagonArch.incompatibility("v73", "v73"))
        // Unknown on either side: let the NPU decide (older packages have no target in metadata.json)
        assertNull(HexagonArch.incompatibility(null, "v73"))
        assertNull(HexagonArch.incompatibility("v79", null))
    }
}
