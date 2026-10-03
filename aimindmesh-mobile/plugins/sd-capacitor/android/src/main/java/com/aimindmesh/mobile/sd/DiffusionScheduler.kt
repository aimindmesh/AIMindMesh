package com.aimindmesh.mobile.sd

import java.util.Random
import kotlin.math.roundToInt
import kotlin.math.sqrt

/** What the UNet predicts: the added noise (SD 1.x, SD 2.x base) or the "velocity" (SD 2.x 768-v). */
enum class PredictionType(val id: String) {
    EPSILON("epsilon"),
    V_PREDICTION("v_prediction");

    companion object {
        fun parse(value: String?): PredictionType? = when (value?.trim()?.lowercase()) {
            "epsilon", "eps" -> EPSILON
            "v_prediction", "v-prediction", "v" -> V_PREDICTION
            else -> null
        }
    }
}

enum class SamplerKind(val id: String) {
    EULER("euler"),
    DPMPP_2M("dpmpp_2m");

    companion object {
        fun parse(value: String?): SamplerKind = entries.firstOrNull { it.id == value?.trim()?.lowercase() } ?: EULER
    }
}

/**
 * Noise schedule of Stable Diffusion (scaled-linear betas over 1000 training steps) in the
 * sigma formulation used by k-diffusion: a latent at noise level sigma is x = x0 + sigma * noise,
 * and the UNet sees x / sqrt(sigma^2 + 1). Samplers work on the denoised estimate x0, so the
 * same code serves epsilon and v-prediction models.
 */
class DiffusionScheduler(
    val numTrainTimesteps: Int = 1000,
    betaStart: Double = 0.00085,
    betaEnd: Double = 0.012
) {
    private val alphasCumprod = DoubleArray(numTrainTimesteps)

    init {
        val startSqrt = sqrt(betaStart)
        val endSqrt = sqrt(betaEnd)
        var cumulative = 1.0
        for (i in 0 until numTrainTimesteps) {
            val betaSqrt = startSqrt + (endSqrt - startSqrt) * i / (numTrainTimesteps - 1)
            cumulative *= 1.0 - betaSqrt * betaSqrt
            alphasCumprod[i] = cumulative
        }
    }

    fun alphaCumprod(timestep: Int): Double = alphasCumprod[timestep.coerceIn(0, numTrainTimesteps - 1)]

    fun sigma(timestep: Int): Double {
        val a = alphaCumprod(timestep)
        return sqrt((1.0 - a) / a)
    }

    /**
     * [numSteps] timesteps, "trailing" spacing (diffusers): evenly from [maxTimestep] down to
     * maxTimestep/numSteps, then the clean image. Ending at t=0 instead makes the last step a huge
     * jump in log-sigma, which second-order samplers overshoot. A quantized UNet only accepts
     * timesteps up to its calibrated maximum (951 for the Qualcomm SD 2.1 package): larger values
     * would be clamped while the latent carries more noise than the model is told.
     */
    fun timesteps(numSteps: Int, maxTimestep: Int): IntArray {
        val top = maxTimestep.coerceIn(1, numTrainTimesteps - 1)
        val steps = numSteps.coerceAtLeast(1)
        return IntArray(steps) { i -> (top - i * (top + 1.0) / steps).roundToInt().coerceAtLeast(0) }
    }

    /** Noise level of each timestep, followed by a final 0 (the clean image). */
    fun sigmas(timesteps: IntArray): DoubleArray =
        DoubleArray(timesteps.size + 1) { i -> if (i < timesteps.size) sigma(timesteps[i]) else 0.0 }

    /** Steps img2img skips at this strength (diffusers: int(steps * strength) steps are run). */
    fun img2imgStartIndex(numSteps: Int, strength: Float): Int {
        val run = (numSteps * strength.coerceIn(0f, 1f)).toInt().coerceIn(1, numSteps)
        return numSteps - run
    }

    /** Standard deviation of a txt2img starting latent: a unit-variance image plus sigma noise. */
    fun initNoiseScale(sigma: Double): Double = sqrt(sigma * sigma + 1.0)

    fun noise(size: Int, random: Random): FloatArray = FloatArray(size) { random.nextGaussian().toFloat() }

    fun addNoise(x0: FloatArray, noise: FloatArray, sigma: Double): FloatArray =
        FloatArray(x0.size) { i -> (x0[i] + noise[i] * sigma).toFloat() }

    fun scaleModelInput(x: FloatArray, sigma: Double): FloatArray {
        val scale = 1.0 / sqrt(sigma * sigma + 1.0)
        return FloatArray(x.size) { i -> (x[i] * scale).toFloat() }
    }

    /** Classifier-free guidance: pushes the conditional prediction away from the unconditional. */
    fun guidance(uncond: FloatArray, cond: FloatArray, scale: Float): FloatArray =
        FloatArray(cond.size) { i -> uncond[i] + scale * (cond[i] - uncond[i]) }

    /** Clean-latent estimate x0 from the UNet output at noise level [sigma]. */
    fun denoised(x: FloatArray, modelOutput: FloatArray, sigma: Double, type: PredictionType): FloatArray =
        when (type) {
            PredictionType.EPSILON -> FloatArray(x.size) { i -> (x[i] - sigma * modelOutput[i]).toFloat() }
            PredictionType.V_PREDICTION -> {
                val c = sigma * sigma + 1.0
                val cOut = sigma / sqrt(c)
                FloatArray(x.size) { i -> (x[i] / c - cOut * modelOutput[i]).toFloat() }
            }
        }

    fun sampler(kind: SamplerKind): Sampler = when (kind) {
        SamplerKind.EULER -> EulerSampler()
        SamplerKind.DPMPP_2M -> DpmPlusPlus2MSampler()
    }
}

/** One sampler instance per generation: DPM++ 2M remembers the previous step. */
interface Sampler {
    /** Moves the latent from [sigma] to [sigmaNext] given the denoised estimate at [sigma]. */
    fun step(x: FloatArray, denoised: FloatArray, sigma: Double, sigmaNext: Double): FloatArray
}

/** Euler (first order) on the probability-flow ODE dx/dsigma = (x - x0) / sigma. */
class EulerSampler : Sampler {
    override fun step(x: FloatArray, denoised: FloatArray, sigma: Double, sigmaNext: Double): FloatArray {
        val dt = sigmaNext - sigma
        return FloatArray(x.size) { i -> (x[i] + (x[i] - denoised[i]) / sigma * dt).toFloat() }
    }
}

/** DPM-Solver++(2M) (Lu et al. 2022), as in k-diffusion: second order from the previous step. */
class DpmPlusPlus2MSampler : Sampler {
    private var previousDenoised: FloatArray? = null
    private var previousSigma = 0.0

    override fun step(x: FloatArray, denoised: FloatArray, sigma: Double, sigmaNext: Double): FloatArray {
        val old = previousDenoised
        val prevSigma = previousSigma
        previousDenoised = denoised
        previousSigma = sigma
        if (sigmaNext <= 0.0) return denoised.copyOf()

        val ratio = sigmaNext / sigma                       // exp(-h), with t = -ln(sigma)
        val h = kotlin.math.ln(sigma / sigmaNext)
        val target = if (old == null) {
            denoised
        } else {
            val r = kotlin.math.ln(prevSigma / sigma) / h   // h_last / h
            val a = 1.0 + 1.0 / (2.0 * r)
            val b = 1.0 / (2.0 * r)
            FloatArray(x.size) { i -> (a * denoised[i] - b * old[i]).toFloat() }
        }
        return FloatArray(x.size) { i -> (ratio * x[i] + (1.0 - ratio) * target[i]).toFloat() }
    }
}
