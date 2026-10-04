package com.aimindmesh.mobile.sd

import kotlin.math.sqrt

/**
 * Prompt weights like `(red car:1.3)` or `[background]`: each weighted token's embedding is moved
 * away from (weight > 1) or toward (weight < 1) the embedding the empty prompt has at the same
 * position. The empty prompt is the neutral reference; the negative prompt is not (its tokens at
 * the same positions are unrelated words).
 */
object PromptWeighting {
    fun needsWeighting(weights: FloatArray): Boolean = weights.any { it != 1.0f }

    fun apply(embedding: FloatArray, weights: FloatArray, reference: FloatArray, dim: Int) {
        require(embedding.size == reference.size && embedding.size == weights.size * dim) { "embedding shape mismatch" }
        for (i in weights.indices) {
            val w = weights[i]
            if (w == 1.0f) continue
            val offset = i * dim
            for (d in 0 until dim) {
                val ref = reference[offset + d]
                embedding[offset + d] = ref + w * (embedding[offset + d] - ref)
            }
        }
    }
}

/**
 * Tells epsilon from v-prediction models with one UNet call on a blank latent (x0 = 0) at a high
 * timestep, where the UNet input is almost pure noise:
 * - an epsilon model returns that noise: output and noise are strongly correlated;
 * - a v model returns sqrt(alphaBar) * noise - sqrt(1 - alphaBar) * x0_estimate, and at high
 *   noise sqrt(alphaBar) is ~0.1 and the x0 estimate is a smooth "average image": the output is
 *   nearly uncorrelated with the noise.
 */
object PredictionTypeProbe {
    const val PROBE_TIMESTEP = 900

    /** UNet input at [alphaBar] for x0 = 0: x_t = sqrt(1 - alphaBar) * noise (already scaled). */
    fun probeInput(noise: FloatArray, alphaBar: Double): FloatArray {
        val s = sqrt(1.0 - alphaBar)
        return FloatArray(noise.size) { i -> (noise[i] * s).toFloat() }
    }

    fun correlation(a: FloatArray, b: FloatArray): Double {
        val n = a.size
        var ma = 0.0
        var mb = 0.0
        for (i in 0 until n) { ma += a[i]; mb += b[i] }
        ma /= n; mb /= n
        var cov = 0.0
        var va = 0.0
        var vb = 0.0
        for (i in 0 until n) {
            val da = a[i] - ma
            val db = b[i] - mb
            cov += da * db; va += da * da; vb += db * db
        }
        return if (va <= 0.0 || vb <= 0.0) 0.0 else cov / sqrt(va * vb)
    }

    /**
     * null when the output is ambiguous: the caller keeps its default. Measured on UberRealistic
     * (v, float32 on CPU): 0.21 at 512 px, 0.41 at 768 px; an epsilon model returns the noise (> 0.9).
     */
    fun decide(output: FloatArray, noise: FloatArray): PredictionType? {
        val c = correlation(output, noise)
        return when {
            c > 0.85 -> PredictionType.EPSILON
            c < 0.7 -> PredictionType.V_PREDICTION
            else -> null
        }
    }
}

/** A rectangle in pixels. */
data class PixelRect(val x: Int, val y: Int, val width: Int, val height: Int) {
    fun scaled(factor: Int) = PixelRect(x * factor, y * factor, width * factor, height * factor)
}

/** Pure geometry of the fixed square canvas the graphs work on. */
object SDGeometry {
    /** Centered crop of a [size] square with the given ratio, e.g. "16:9" on 512 -> 512x288 at y=112. */
    fun aspectCrop(size: Int, ratio: String?): PixelRect {
        val parts = ratio?.split(":")?.mapNotNull { it.trim().toIntOrNull() }
        if (parts == null || parts.size != 2 || parts[0] <= 0 || parts[1] <= 0 || parts[0] == parts[1]) {
            return PixelRect(0, 0, size, size)
        }
        val (rw, rh) = parts
        return if (rw > rh) {
            val h = size * rh / rw
            PixelRect(0, (size - h) / 2, size, h)
        } else {
            val w = size * rw / rh
            PixelRect((size - w) / 2, 0, w, size)
        }
    }

    /** Where a [srcW]x[srcH] image lands when fitted, centered, in a [size] square. */
    fun fitInSquare(srcW: Int, srcH: Int, size: Int): PixelRect {
        require(srcW > 0 && srcH > 0) { "empty image" }
        return if (srcW >= srcH) {
            val h = maxOf(1, Math.round(size.toDouble() * srcH / srcW).toInt())
            PixelRect(0, (size - h) / 2, size, h)
        } else {
            val w = maxOf(1, Math.round(size.toDouble() * srcW / srcH).toInt())
            PixelRect((size - w) / 2, 0, w, size)
        }
    }

    /** Mirrors an index into [0, n) without repeating the edge pixel (… 2 1 | 0 1 2 … n-1 | n-2 …). */
    fun reflect(i: Int, n: Int): Int {
        if (n == 1) return 0
        val period = 2 * (n - 1)
        val m = ((i % period) + period) % period
        return if (m < n) m else period - m
    }

    /**
     * Places [content] (rect.width x rect.height pixels) at [rect] in a [size] square and fills
     * the margins with its mirror image, so the diffusion model sees a plausible continuation
     * instead of flat bars (the margins are cropped away after decoding).
     */
    fun reflectPad(content: IntArray, rect: PixelRect, size: Int): IntArray {
        require(content.size == rect.width * rect.height) { "content size mismatch" }
        val out = IntArray(size * size)
        for (y in 0 until size) {
            val sy = reflect(y - rect.y, rect.height)
            for (x in 0 until size) {
                out[y * size + x] = content[sy * rect.width + reflect(x - rect.x, rect.width)]
            }
        }
        return out
    }
}
