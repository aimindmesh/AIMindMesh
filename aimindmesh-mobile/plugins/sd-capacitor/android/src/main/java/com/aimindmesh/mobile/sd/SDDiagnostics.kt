package com.aimindmesh.mobile.sd

import java.util.Locale
import kotlin.math.abs
import kotlin.math.sqrt

/** Mean, standard deviation and NaN/Inf count of (a slice of) a tensor. */
data class TensorStats(val mean: Double, val std: Double, val nonFinite: Int) {
    override fun toString(): String = String.format(Locale.ROOT, "mean %.4f std %.4f", mean, std) +
        if (nonFinite > 0) " ($nonFinite NaN/Inf)" else ""

    companion object {
        /** Statistics of x[from until to], ignoring non-finite values. */
        fun of(x: FloatArray, from: Int = 0, to: Int = x.size): TensorStats {
            var n = 0
            var sum = 0.0
            var sumSq = 0.0
            var bad = 0
            for (i in from until to) {
                val v = x[i]
                if (!v.isFinite()) { bad++; continue }
                n++; sum += v; sumSq += v.toDouble() * v
            }
            if (n == 0) return TensorStats(0.0, 0.0, bad)
            val mean = sum / n
            return TensorStats(mean, sqrt(maxOf(0.0, sumSq / n - mean * mean)), bad)
        }
    }
}

/**
 * Sanity checks on what the NPU graphs return, so a broken export fails loudly instead of
 * producing images that ignore the prompt.
 */
object SDDiagnostics {
    private const val UNTRAINED_TOLERANCE = 0.01

    /** Throws when a graph returned NaN/Inf (e.g. an FP16 overflow inside an exported graph). */
    fun requireFinite(x: FloatArray, what: String) {
        val bad = x.count { !it.isFinite() }
        if (bad > 0) throw IllegalStateException("$what returned $bad NaN/Inf values out of ${x.size}: the exported model overflows on the NPU")
    }

    /**
     * True when every token of a text embedding is normalized to mean 0 and std 1: the output of a
     * final LayerNorm still at its initial weights (1 and 0), i.e. a text encoder exported without
     * its trained weights. Trained CLIP / OpenCLIP LayerNorms have learned biases (SD 2.x: mean bias
     * about -0.16), so their tokens are not centered.
     */
    fun looksUntrainedTextEncoder(embedding: FloatArray, dim: Int): Boolean {
        if (dim <= 0 || embedding.isEmpty() || embedding.size % dim != 0) return false
        for (offset in embedding.indices step dim) {
            val s = TensorStats.of(embedding, offset, offset + dim)
            if (s.nonFinite > 0 || abs(s.mean) > UNTRAINED_TOLERANCE || abs(s.std - 1.0) > UNTRAINED_TOLERANCE) return false
        }
        return true
    }

    /** Root mean square of a - b: how much the prompt changes the UNet prediction (~0: it does not). */
    fun rmsDifference(a: FloatArray, b: FloatArray): Double {
        require(a.size == b.size) { "size mismatch" }
        var sum = 0.0
        for (i in a.indices) {
            val d = (a[i] - b[i]).toDouble()
            sum += d * d
        }
        return if (a.isEmpty()) 0.0 else sqrt(sum / a.size)
    }
}
