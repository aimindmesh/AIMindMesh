package com.aimindmesh.mobile.sd

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Random

class SDDiagnosticsTest {
    private val dim = 1024

    /** 77 tokens through a LayerNorm with the given per-channel weight and bias. */
    private fun layerNormOutput(weight: (Int) -> Float, bias: (Int) -> Float, seed: Long = 3): FloatArray {
        val random = Random(seed)
        val out = FloatArray(77 * dim)
        for (t in 0 until 77) {
            val raw = DoubleArray(dim) { random.nextGaussian() * 3 + 0.5 }
            val mean = raw.average()
            val std = kotlin.math.sqrt(raw.sumOf { (it - mean) * (it - mean) } / dim + 1e-5)
            for (d in 0 until dim) out[t * dim + d] = ((raw[d] - mean) / std).toFloat() * weight(d) + bias(d)
        }
        return out
    }

    @Test
    fun recognizesTheRandomInitTextEncoder() {
        // Untrained final LayerNorm: weight 1, bias 0 -> every token has mean 0, std 1
        assertTrue(SDDiagnostics.looksUntrainedTextEncoder(layerNormOutput({ 1f }, { 0f }), dim))
    }

    @Test
    fun acceptsATrainedTextEncoder() {
        // UberRealistic's ln_final: weight mean 1.05 (std 0.07), bias mean -0.165 (std 0.2)
        val random = Random(9)
        val weight = FloatArray(dim) { (1.05 + 0.07 * random.nextGaussian()).toFloat() }
        val bias = FloatArray(dim) { (-0.165 + 0.2 * random.nextGaussian()).toFloat() }
        assertFalse(SDDiagnostics.looksUntrainedTextEncoder(layerNormOutput({ weight[it] }, { bias[it] }), dim))
        // A single trained-looking token is enough to clear the encoder
        val mostlyNormalized = layerNormOutput({ 1f }, { 0f })
        for (d in 0 until dim) mostlyNormalized[40 * dim + d] += 0.3f
        assertFalse(SDDiagnostics.looksUntrainedTextEncoder(mostlyNormalized, dim))
        assertFalse(SDDiagnostics.looksUntrainedTextEncoder(FloatArray(10), dim))
    }

    @Test
    fun nonFiniteOutputsFailLoudly() {
        SDDiagnostics.requireFinite(floatArrayOf(0f, -3.5f, 1e30f), "UNet")
        val error = runCatching { SDDiagnostics.requireFinite(floatArrayOf(1f, Float.NaN, Float.POSITIVE_INFINITY), "The UNet") }.exceptionOrNull()
        assertTrue(error is IllegalStateException)
        assertTrue(error!!.message!!.startsWith("The UNet returned 2 NaN/Inf values out of 3"))
    }

    @Test
    fun statisticsSkipNonFiniteValues() {
        val s = TensorStats.of(floatArrayOf(1f, 3f, Float.NaN, 1f, 3f))
        assertEquals(2.0, s.mean, 1e-9)
        assertEquals(1.0, s.std, 1e-9)
        assertEquals(1, s.nonFinite)
        assertEquals(TensorStats(5.0, 0.0, 0), TensorStats.of(floatArrayOf(9f, 5f, 5f), 1, 3))
        assertEquals(0.5, SDDiagnostics.rmsDifference(floatArrayOf(1f, 2f), floatArrayOf(1.5f, 1.5f)), 1e-9)
    }
}
