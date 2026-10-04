package com.aimindmesh.mobile.genie

import java.io.File

/**
 * GGUF models run through GenieX's `llama_cpp` runtime: the same file on the NPU of every
 * Snapdragon with Hexagon v68+ (the AAR ships libggml-htp-v68…v81). Pure decisions, unit tested.
 */
object GgufSupport {
    /** Weight formats the Hexagon kernels of GenieX 0.3.5 run on the NPU (K-quants are not among them) */
    val NPU_FORMATS = listOf("Q4_0", "Q4_1", "IQ4_NL", "MXFP4", "Q8_0")

    private val FORMAT = Regex("(?i)(IQ\\d_[A-Z]{1,3}|Q\\d_K_[SML]|Q\\d_K|Q\\d_\\d|MXFP4|BF16|F16|F32)")

    fun isGguf(path: String): Boolean = path.trim().lowercase().endsWith(".gguf")

    /** Weight format from the file name: "Qwen3.5-4B-Q4_0.gguf" → Q4_0, "gemma-4-E2B_q4_0-it.gguf" → Q4_0 */
    fun weightFormat(fileName: String): String? = FORMAT.find(fileName)?.value?.uppercase()

    fun npuReady(fileName: String): Boolean = weightFormat(fileName) in NPU_FORMATS

    /**
     * Compute units to try, in order: `auto` falls back from the NPU to the GPU, then the CPU.
     * Weights without NPU kernels (K-quants) start from the GPU: on the NPU they load, but almost
     * all of them run on the CPU (measured on SM8750: 14.5 tok/s vs 23.4 on the GPU).
     */
    fun unitsFor(requested: String?, npuReady: Boolean = true): List<String> = when (requested?.trim()?.lowercase()) {
        "npu" -> listOf("npu")
        "gpu" -> listOf("gpu")
        "cpu" -> listOf("cpu")
        else -> if (npuReady) listOf("npu", "gpu", "cpu") else listOf("gpu", "cpu")
    }

    /**
     * GenieX 0.3.5 llama_cpp reuses the common token prefix between generations, but after a
     * partial rollback its token list keeps growing and every later call fails with "Context length
     * exceeded". So its cache is reset unless the new prompt continues the last one completed (the
     * next chat turn), or when the last generation did not complete.
     */
    fun mustResetBefore(cachedPrompt: String?, dirty: Boolean, prompt: String): Boolean =
        dirty || (cachedPrompt != null && !prompt.startsWith(cachedPrompt))

    fun isContextOverflow(message: String?): Boolean = message?.contains("Context length exceeded", ignoreCase = true) == true

    /** Whether the loaded unit is what was asked for (`auto` accepts whichever unit loaded) */
    fun unitSatisfies(requested: String?, active: String?): Boolean =
        active != null && unitsFor(requested).let { it.size > 1 || it.first() == active }

    /** Layers offloaded to the accelerator: all of them, none on the CPU */
    fun gpuLayersFor(unit: String): Int = if (unit == "cpu") 0 else 999

    /** Context window of a GGUF: the configured one (0 would mean the model's training window, far too big) */
    fun contextFor(requested: Int?): Int = if (requested != null && requested > 0) requested else 4096

    /** The model file: an absolute path, or a name in the app's files dir (as the GGUF downloader saves it) */
    fun resolve(filesDir: File, path: String): File? {
        if (!isGguf(path)) return null
        val direct = File(path)
        if (direct.isAbsolute) return direct.takeIf { it.isFile }
        return File(filesDir, path).takeIf { it.isFile }
    }
}
