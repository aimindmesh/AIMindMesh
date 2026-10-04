package com.aimindmesh.mobile.sd

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Random
import kotlin.math.abs
import kotlin.math.sqrt

class DiffusionSchedulerTest {
    private val scheduler = DiffusionScheduler()

    @Test
    fun noiseScheduleMatchesStableDiffusion() {
        assertEquals(14.6146, scheduler.sigma(999), 1e-3)
        assertEquals(0.02917, scheduler.sigma(0), 1e-4)
        assertEquals(11.0283, scheduler.sigma(951), 1e-3)
    }

    @Test
    fun timestepsStayInsideTheCalibratedRange() {
        val ts = scheduler.timesteps(25, 951)
        assertEquals(25, ts.size)
        assertEquals(951, ts.first())
        assertEquals(37, ts.last())
        for (i in 1 until ts.size) assertTrue(ts[i] < ts[i - 1])
        // Float models use the whole range: diffusers' trailing spacing
        assertArrayEquals(intArrayOf(999, 949, 899), scheduler.timesteps(20, 999).copyOfRange(0, 3))
        assertEquals(49, scheduler.timesteps(20, 999).last())
        val sigmas = scheduler.sigmas(ts)
        assertEquals(26, sigmas.size)
        assertEquals(0.0, sigmas.last(), 0.0)
    }

    @Test
    fun img2imgRunsStrengthTimesSteps() {
        assertEquals(9, scheduler.img2imgStartIndex(25, 0.65f))   // 16 of 25 steps run
        assertEquals(0, scheduler.img2imgStartIndex(20, 1f))
        assertEquals(19, scheduler.img2imgStartIndex(20, 0.01f))  // at least one step
    }

    @Test
    fun bothParametrizationsRecoverTheCleanLatent() {
        val random = Random(7)
        val x0 = scheduler.noise(256, random)
        val eps = scheduler.noise(256, random)
        for (sigma in listOf(0.1, 1.0, 14.6)) {
            val x = scheduler.addNoise(x0, eps, sigma)
            val c = sqrt(sigma * sigma + 1)
            val v = FloatArray(256) { i -> ((eps[i] - sigma * x0[i]) / c).toFloat() } // v = sqrt(a)*eps - sqrt(1-a)*x0
            val fromEps = scheduler.denoised(x, eps, sigma, PredictionType.EPSILON)
            val fromV = scheduler.denoised(x, v, sigma, PredictionType.V_PREDICTION)
            for (i in 0 until 256) {
                assertEquals(x0[i].toDouble(), fromEps[i].toDouble(), 1e-4 * (1 + sigma))
                assertEquals(x0[i].toDouble(), fromV[i].toDouble(), 1e-4 * (1 + sigma))
            }
        }
    }

    /**
     * Data x0 ~ N(mu, s^2): the ideal denoiser is known in closed form, so a correct sampler must
     * turn the starting noise into samples with mean mu and standard deviation close to s.
     */
    private fun sampleGaussian(kind: SamplerKind, type: PredictionType, steps: Int, top: Int): FloatArray {
        val mu = 0.5
        val s = 0.8
        val n = 20000
        val timesteps = scheduler.timesteps(steps, top)
        val sigmas = scheduler.sigmas(timesteps)
        val random = Random(42)
        val start = sqrt(s * s + sigmas[0] * sigmas[0])
        var x = FloatArray(n) { (mu + random.nextGaussian() * start).toFloat() }
        val sampler = scheduler.sampler(kind)
        for (i in timesteps.indices) {
            val sigma = sigmas[i]
            val ideal = FloatArray(n) { j -> ((s * s * x[j] + sigma * sigma * mu) / (s * s + sigma * sigma)).toFloat() }
            // What a perfect UNet would output for this sigma, in the model's own parametrization
            val output = when (type) {
                PredictionType.EPSILON -> FloatArray(n) { j -> ((x[j] - ideal[j]) / sigma).toFloat() }
                PredictionType.V_PREDICTION -> {
                    val c = sigma * sigma + 1
                    FloatArray(n) { j -> ((x[j] / c - ideal[j]) * sqrt(c) / sigma).toFloat() }
                }
            }
            val denoised = scheduler.denoised(x, output, sigma, type)
            x = sampler.step(x, denoised, sigma, sigmas[i + 1])
        }
        return x
    }

    private fun stats(x: FloatArray): Pair<Double, Double> {
        val mean = x.sumOf { it.toDouble() } / x.size
        val variance = x.sumOf { (it - mean) * (it - mean) } / x.size
        return mean to sqrt(variance)
    }

    @Test
    fun samplersConvergeToTheDataDistribution() {
        for (type in PredictionType.entries) {
            val (meanDpm, stdDpm) = stats(sampleGaussian(SamplerKind.DPMPP_2M, type, 25, 951))
            assertEquals("DPM++ 2M mean ($type)", 0.5, meanDpm, 0.02)
            assertEquals("DPM++ 2M std ($type)", 0.8, stdDpm, 0.8 * 0.05)

            val (meanEuler, stdEuler) = stats(sampleGaussian(SamplerKind.EULER, type, 25, 951))
            assertEquals("Euler mean ($type)", 0.5, meanEuler, 0.02)
            // First order: slightly under-dispersed at 25 steps (analytically 0.934 * s)
            assertTrue("Euler std ($type) = $stdEuler", stdEuler in 0.8 * 0.88..0.8 * 1.0)
        }
    }

    @Test
    fun epsilonAndVGiveTheSameTrajectory() {
        val a = sampleGaussian(SamplerKind.DPMPP_2M, PredictionType.EPSILON, 20, 999)
        val b = sampleGaussian(SamplerKind.DPMPP_2M, PredictionType.V_PREDICTION, 20, 999)
        var maxDiff = 0.0
        for (i in a.indices) maxDiff = maxOf(maxDiff, abs(a[i] - b[i]).toDouble())
        assertTrue("max difference $maxDiff", maxDiff < 1e-3)
    }

    @Test
    fun parsesOptions() {
        assertEquals(SamplerKind.DPMPP_2M, SamplerKind.parse("dpmpp_2m"))
        assertEquals(SamplerKind.EULER, SamplerKind.parse("unknown"))
        assertEquals(SamplerKind.EULER, SamplerKind.parse(null))
        assertEquals(PredictionType.V_PREDICTION, PredictionType.parse("v_prediction"))
        assertEquals(PredictionType.EPSILON, PredictionType.parse("Epsilon"))
        assertEquals(null, PredictionType.parse("sample"))
    }

    @Test
    fun guidanceInterpolatesFromTheUnconditionalPrediction() {
        val uncond = floatArrayOf(1f, -2f, 0.5f)
        val cond = floatArrayOf(3f, -1f, 0.5f)
        assertArrayEquals(uncond, scheduler.guidance(uncond, cond, 0f), 0f)
        assertArrayEquals(cond, scheduler.guidance(uncond, cond, 1f), 0f)
        // diffusers: uncond + scale * (cond - uncond)
        assertArrayEquals(floatArrayOf(16f, 5.5f, 0.5f), scheduler.guidance(uncond, cond, 7.5f), 1e-5f)
    }

    @Test
    fun readsThePredictionTypeOfAPackage() {
        assertEquals(PredictionType.V_PREDICTION, PredictionType.fromMetadata("""{"prediction_type": "v_prediction", "model_files": {}}"""))
        assertEquals(PredictionType.EPSILON, PredictionType.fromMetadata("""{"prediction_type": "epsilon"}"""))
        assertEquals(null, PredictionType.fromMetadata("""{"model_name": "SD 2.1"}"""))
    }
}
