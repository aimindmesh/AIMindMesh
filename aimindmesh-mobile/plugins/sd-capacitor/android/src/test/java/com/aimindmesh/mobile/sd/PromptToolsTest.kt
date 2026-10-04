package com.aimindmesh.mobile.sd

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Random
import kotlin.math.sqrt

class PromptToolsTest {
    @Test
    fun weightsMoveTokensRelativeToTheEmptyPrompt() {
        val dim = 2
        val embedding = floatArrayOf(1f, 1f, 3f, 5f, 2f, 2f)
        val reference = floatArrayOf(1f, 1f, 1f, 1f, 0f, 0f)
        PromptWeighting.apply(embedding, floatArrayOf(1f, 1.5f, 0f), reference, dim)
        assertArrayEquals(floatArrayOf(1f, 1f, 4f, 7f, 0f, 0f), embedding, 1e-6f)
    }

    @Test
    fun probeTellsEpsilonFromVPrediction() {
        val scheduler = DiffusionScheduler()
        val alphaBar = scheduler.alphaCumprod(PredictionTypeProbe.PROBE_TIMESTEP)
        val random = Random(3)
        val n = 64 * 64 * 4
        val noise = scheduler.noise(n, random)
        val input = PredictionTypeProbe.probeInput(noise, alphaBar)
        assertEquals(sqrt(1 - alphaBar), (input[0] / noise[0]).toDouble(), 1e-5)

        // An epsilon model recovers the noise (here with 30% error)
        val epsOut = FloatArray(n) { i -> noise[i] + 0.3f * random.nextGaussian().toFloat() }
        assertEquals(PredictionType.EPSILON, PredictionTypeProbe.decide(epsOut, noise))

        // A v model: sqrt(a)*noise - sqrt(1-a)*x0_hat, with a smooth x0 estimate slightly tied to the noise
        val smooth = FloatArray(n) { i -> (0.4 * kotlin.math.sin(i / 300.0)).toFloat() }
        val x0Hat = FloatArray(n) { i -> smooth[i] + (sqrt(alphaBar) * input[i]).toFloat() }
        val vOut = FloatArray(n) { i -> (sqrt(alphaBar) * noise[i] - sqrt(1 - alphaBar) * x0Hat[i]).toFloat() }
        assertEquals(PredictionType.V_PREDICTION, PredictionTypeProbe.decide(vOut, noise))

        // Correlations measured on UberRealistic (v): 0.41 at 768 px on CPU, 0.6 on the NPU with a broken text encoder
        for (c in listOf(0.41f, 0.6f)) {
            val out = FloatArray(n) { i -> c * noise[i] + sqrt(1f - c * c) * random.nextGaussian().toFloat() }
            assertEquals(PredictionType.V_PREDICTION, PredictionTypeProbe.decide(out, noise))
        }

        // Ambiguous output: no decision
        val mixed = FloatArray(n) { i -> 0.78f * noise[i] + 0.626f * random.nextGaussian().toFloat() }
        assertNull(PredictionTypeProbe.decide(mixed, noise))
    }

    @Test
    fun aspectCropsAreCentered() {
        assertEquals(PixelRect(0, 112, 512, 288), SDGeometry.aspectCrop(512, "16:9"))
        assertEquals(PixelRect(112, 0, 288, 512), SDGeometry.aspectCrop(512, "9:16"))
        assertEquals(PixelRect(0, 64, 512, 384), SDGeometry.aspectCrop(512, "4:3"))
        assertEquals(PixelRect(64, 0, 384, 512), SDGeometry.aspectCrop(512, "3:4"))
        assertEquals(PixelRect(0, 0, 512, 512), SDGeometry.aspectCrop(512, "1:1"))
        assertEquals(PixelRect(0, 0, 512, 512), SDGeometry.aspectCrop(512, "wide"))
        assertEquals(PixelRect(0, 448, 2048, 1152), SDGeometry.aspectCrop(512, "16:9").scaled(4))
    }

    @Test
    fun sourcesFitWithoutDistortion() {
        assertEquals(PixelRect(0, 64, 512, 384), SDGeometry.fitInSquare(4000, 3000, 512))
        assertEquals(PixelRect(64, 0, 384, 512), SDGeometry.fitInSquare(3000, 4000, 512))
        assertEquals(PixelRect(0, 0, 512, 512), SDGeometry.fitInSquare(1024, 1024, 512))
        assertEquals(PixelRect(0, 224, 512, 64), SDGeometry.fitInSquare(4096, 512, 512))
    }

    @Test
    fun marginsMirrorTheContent() {
        assertEquals(listOf(2, 1, 0, 1, 2, 1, 0), (-2..4).map { SDGeometry.reflect(it, 3) })
        assertEquals(0, SDGeometry.reflect(5, 1))
        // 2x1 content [A B] at x=1 of a 4x4 square: rows repeat (height 1), columns mirror
        val padded = SDGeometry.reflectPad(intArrayOf(10, 20), PixelRect(1, 1, 2, 1), 4)
        val row = intArrayOf(20, 10, 20, 10)
        for (y in 0 until 4) assertArrayEquals(row, padded.copyOfRange(y * 4, y * 4 + 4))
    }
}
