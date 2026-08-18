package com.aimindmesh.mobile.sd

import java.util.Random
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.pow
import kotlin.math.sqrt

/**
 * Euler Discrete & Ancestral Scheduler for Stable Diffusion 1.5 & 2.1.
 * Supports 1000-step continuous diffusion schedule mapped to N inference steps.
 */
class EulerAncestralScheduler(
    val numTrainTimesteps: Int = 1000,
    val betaStart: Float = 0.00085f,
    val betaEnd: Float = 0.012f
) {
    companion object {
        const val LATENT_CHANNELS = 4
        const val LATENT_HEIGHT = 64
        const val LATENT_WIDTH = 64
        const val LATENT_SIZE = LATENT_CHANNELS * LATENT_HEIGHT * LATENT_WIDTH
    }

    private val betas = FloatArray(numTrainTimesteps)
    private val alphas = FloatArray(numTrainTimesteps)
    private val alphasCumprod = FloatArray(numTrainTimesteps)
    private val sigmas = FloatArray(numTrainTimesteps)

    init {
        // Scaled linear beta schedule for latent diffusion
        val startSqrt = sqrt(betaStart)
        val endSqrt = sqrt(betaEnd)
        var cumulativeAlpha = 1.0f

        for (i in 0 until numTrainTimesteps) {
            val t = i.toFloat() / (numTrainTimesteps - 1)
            val betaSqrt = startSqrt + t * (endSqrt - startSqrt)
            val beta = betaSqrt * betaSqrt
            betas[i] = beta
            val alpha = 1.0f - beta
            alphas[i] = alpha
            cumulativeAlpha *= alpha
            alphasCumprod[i] = cumulativeAlpha
            sigmas[i] = sqrt((1.0f - cumulativeAlpha) / cumulativeAlpha)
        }
    }

    /**
     * Compute discretized timesteps and sigmas matching Hugging Face Diffusers EulerDiscreteScheduler.
     */
    fun setTimesteps(numInferenceSteps: Int): Pair<IntArray, FloatArray> {
        val stepRatio = numTrainTimesteps / numInferenceSteps
        val timesteps = IntArray(numInferenceSteps)
        val stepSigmas = FloatArray(numInferenceSteps + 1)

        for (i in 0 until numInferenceSteps) {
            val t = (numInferenceSteps - 1 - i) * stepRatio
            timesteps[i] = t
            stepSigmas[i] = sigmas[t]
        }
        stepSigmas[numInferenceSteps] = 0.0f
        return Pair(timesteps, stepSigmas)
    }

    /**
     * Scale model input latents for Euler discrete scheduler: latents / sqrt(sigma^2 + 1)
     */
    fun scaleModelInput(sample: FloatArray, stepIndex: Int, stepSigmas: FloatArray): FloatArray {
        val sigma = stepSigmas[stepIndex]
        val scale = 1.0f / sqrt(sigma * sigma + 1.0f)
        val scaled = FloatArray(sample.size)
        for (i in sample.indices) {
            scaled[i] = sample[i] * scale
        }
        return scaled
    }

    /**
     * Generate initial Gaussian noise latent tensor [1, 64, 64, 4].
     */
    fun generateInitialLatents(seed: Long = -1, initialSigma: Float = 1.0f): FloatArray {
        val rand = if (seed >= 0) Random(seed) else Random()
        val latents = FloatArray(LATENT_SIZE)

        for (i in latents.indices) {
            // Box-Muller standard normal distribution
            val u1 = rand.nextFloat().coerceAtLeast(1e-7f)
            val u2 = rand.nextFloat()
            val z0 = sqrt(-2.0f * ln(u1)) * kotlin.math.cos(2.0f * Math.PI.toFloat() * u2)
            latents[i] = z0 * initialSigma
        }
        return latents
    }

    /**
     * Combine unconditional and conditional noise estimates with Classifier-Free Guidance (CFG).
     * Includes guidance_rescale (Lin et al. 2023) to prevent overexposure/burn at high CFG scales.
     */
    fun applyClassifierFreeGuidance(
        noiseUncond: FloatArray,
        noiseCond: FloatArray,
        cfgScale: Float,
        guidanceRescale: Float = 0.0f
    ): FloatArray {
        val result = FloatArray(noiseCond.size)
        var sumCond = 0.0
        var sumSqCond = 0.0
        var sumCfg = 0.0
        var sumSqCfg = 0.0

        for (i in result.indices) {
            val uncond = noiseUncond[i]
            val cond = noiseCond[i]
            val cfgVal = uncond + cfgScale * (cond - uncond)
            result[i] = cfgVal

            if (guidanceRescale > 0.0f) {
                sumCond += cond
                sumSqCond += cond * cond
                sumCfg += cfgVal
                sumSqCfg += cfgVal * cfgVal
            }
        }

        if (guidanceRescale > 0.0f && result.isNotEmpty()) {
            val n = result.size.toDouble()
            val meanCond = sumCond / n
            val varCond = (sumSqCond / n) - (meanCond * meanCond)
            val stdCond = sqrt(varCond.coerceAtLeast(1e-8)).toFloat()

            val meanCfg = sumCfg / n
            val varCfg = (sumSqCfg / n) - (meanCfg * meanCfg)
            val stdCfg = sqrt(varCfg.coerceAtLeast(1e-8)).toFloat()

            val factor = stdCond / (stdCfg + 1e-8f)
            for (i in result.indices) {
                val rescaled = result[i] * factor
                result[i] = guidanceRescale * rescaled + (1.0f - guidanceRescale) * result[i]
            }
        }

        return result
    }

    /**
     * Perform a single Euler step: z_t -> z_{t-1}.
     * Supports both v_prediction (Stable Diffusion 2.1) and epsilon (Stable Diffusion 1.5).
     */
    fun step(
        modelOutput: FloatArray,
        stepIndex: Int,
        stepSigmas: FloatArray,
        currentLatents: FloatArray,
        seed: Long = -1,
        predictionType: String = "v_prediction",
        ancestral: Boolean = false
    ): FloatArray {
        val sigma = stepSigmas[stepIndex]
        val sigmaNext = stepSigmas[stepIndex + 1]

        val sigmaUp = if (ancestral && sigmaNext > 0.0f) {
            sqrt(sigmaNext.pow(2) * (sigma.pow(2) - sigmaNext.pow(2)) / sigma.pow(2)).coerceAtLeast(0.0f)
        } else {
            0.0f
        }
        val sigmaDown = if (ancestral && sigmaNext > 0.0f) {
            sqrt(sigmaNext.pow(2) - sigmaUp.pow(2)).coerceAtLeast(0.0f)
        } else {
            sigmaNext
        }

        val nextLatents = FloatArray(currentLatents.size)
        val rand = if (seed >= 0) Random(seed + stepIndex) else Random()
        val dt = sigmaDown - sigma

        val isVPrediction = predictionType.equals("v_prediction", ignoreCase = true)
        val invSqrtSigmaSqPlusOne = 1.0f / sqrt(sigma * sigma + 1.0f)
        val sigmaOverSigmaSqPlusOne = sigma / (sigma * sigma + 1.0f)

        for (i in currentLatents.indices) {
            val sample = currentLatents[i]
            val out = modelOutput[i]

            val derivative = if (isVPrediction) {
                // v_prediction: d = (sigma / (sigma^2 + 1)) * sample + (1 / sqrt(sigma^2 + 1)) * modelOutput
                sigmaOverSigmaSqPlusOne * sample + invSqrtSigmaSqPlusOne * out
            } else {
                // epsilon prediction: d = modelOutput
                out
            }

            var updated = sample + derivative * dt

            // Add ancestral stochastic noise only if ancestral mode is requested
            if (sigmaUp > 0.0f) {
                val u1 = rand.nextFloat().coerceAtLeast(1e-7f)
                val u2 = rand.nextFloat()
                val noise = sqrt(-2.0f * ln(u1)) * kotlin.math.cos(2.0f * Math.PI.toFloat() * u2)
                updated += noise * sigmaUp
            }

            nextLatents[i] = updated
        }

        return nextLatents
    }

    /**
     * Add noise to an initial latent for Image-to-Image (img2img) editing.
     * In Euler Discrete Scheduler: noisy_samples = original_samples + noise * sigma
     */
    fun addNoise(
        initialLatents: FloatArray,
        noise: FloatArray,
        sigma: Float
    ): FloatArray {
        val noisy = FloatArray(initialLatents.size)
        for (i in noisy.indices) {
            noisy[i] = initialLatents[i] + noise[i] * sigma
        }
        return noisy
    }
}
