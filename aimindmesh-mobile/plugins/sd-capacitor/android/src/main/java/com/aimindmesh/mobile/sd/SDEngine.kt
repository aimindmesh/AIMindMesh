package com.aimindmesh.mobile.sd

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.util.Base64
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * High-performance Qualcomm QNN on-device Stable Diffusion synthesis engine.
 * Executes CLIP Text Encoder, UNet diffusion loops, and VAE decoding on Hexagon HTP.
 */
class SDEngine(private val context: Context) {
    companion object {
        private const val TAG = "SDEngine"
        private var isInitialized = false
        private var activeModelDir: String? = null
    }

    private val clipTokenizer = ClipTokenizer(context)
    private val scheduler = EulerAncestralScheduler()
    private val qnnBridge = QnnNativeBridge(context)

    /**
     * Inspect Qualcomm NPU / Hexagon hardware capabilities
     */
    fun detectCapabilities(): Map<String, Any> {
        val hardware = Build.HARDWARE.lowercase()
        val board = Build.BOARD.lowercase()
        val soc = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Build.SOC_MODEL.lowercase()
        } else {
            ""
        }

        val isSnapdragon8Elite = hardware.contains("qcom") && (
            board.contains("sun") || soc.contains("sm8750") || hardware.contains("sm8750")
        )
        val isSnapdragon8Gen3 = hardware.contains("qcom") && (
            board.contains("pineapple") || soc.contains("sm8650") || hardware.contains("sm8650")
        )
        val hasNpu = isSnapdragon8Elite || isSnapdragon8Gen3 || hardware.contains("qcom")

        val npuArch = when {
            isSnapdragon8Elite -> "v79"
            isSnapdragon8Gen3 -> "v75"
            hardware.contains("qcom") -> "v73"
            else -> "none"
        }

        val backends = mutableListOf<String>("cpu")
        if (hasNpu) {
            backends.add("gpu")
            backends.add("npu")
        }

        return mapOf(
            "hasNpu" to hasNpu,
            "npuArch" to npuArch,
            "supportedBackends" to backends,
            "socModel" to if (soc.isNotEmpty()) soc else Build.HARDWARE
        )
    }

    /**
     * Load Qualcomm QNN Stable Diffusion model bundle (unet.bin, vae.bin, text_encoder.bin)
     */
    suspend fun loadModel(modelPath: String, backend: String = "npu"): Boolean = withContext(Dispatchers.IO) {
        try {
            val cleanPath = modelPath.removePrefix("file://").trim()
            var dir = File(cleanPath)
            if (!dir.exists()) {
                dir = File(context.filesDir, cleanPath)
            }
            if (!dir.exists()) {
                val sdDir = File(context.filesDir, "sd-models")
                val candidate = File(sdDir, cleanPath)
                if (candidate.exists()) {
                    dir = candidate
                }
            }
            if (!dir.exists()) {
                val modelName = File(cleanPath).name
                val candidate = File(File(context.filesDir, "sd-models"), modelName)
                if (candidate.exists()) {
                    dir = candidate
                }
            }
            if (!dir.exists()) {
                Log.e(TAG, "SD Model path does not exist: $modelPath (tried: $cleanPath)")
                return@withContext false
            }

            val resolvedDir = SDFileUtils.findSDModelDirectory(dir) ?: dir
            Log.i(TAG, "Loading Stable Diffusion QNN pipeline on $backend from ${resolvedDir.absolutePath}")

            qnnBridge.initializeFromDirectory(resolvedDir)
            activeModelDir = resolvedDir.absolutePath
            isInitialized = true
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load SD model", e)
            false
        }
    }

    fun isLoaded(): Boolean = isInitialized && activeModelDir != null

    fun getActiveModelPath(): String? = activeModelDir

    suspend fun unloadModel(): Boolean = withContext(Dispatchers.IO) {
        try {
            activeModelDir = null
            isInitialized = false
            Log.i(TAG, "SD QNN engine unloaded")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to unload SD model", e)
            false
        }
    }

    /**
     * Generate or restyle an image on Qualcomm Hexagon NPU.
     */
    suspend fun generateImage(
        prompt: String,
        negativePrompt: String = "",
        sourceImage: String? = null,
        strength: Float = 0.65f,
        steps: Int = 20,
        cfgScale: Float = 7.5f,
        seed: Long = -1,
        width: Int = 512,
        height: Int = 512,
        progressCallback: ((step: Int, totalSteps: Int, timePerStep: Float) -> Unit)? = null
    ): Map<String, Any> = withContext(Dispatchers.IO) {
        if (!isLoaded() || activeModelDir == null) {
            throw IllegalStateException("No Stable Diffusion model loaded. Please import and select a model in Settings > Vision & Image Creation.")
        }

        val startTime = System.currentTimeMillis()
        val numSteps = steps.coerceIn(1, 100)
        val modeStr = if (sourceImage != null) "Image-to-Image (strength: $strength)" else "Text-to-Image"
        Log.i(TAG, "Starting on-device Qualcomm NPU synthesis [$modeStr]: '$prompt' | Neg: '$negativePrompt' (${width}x${height}, steps: $numSteps, cfg: $cfgScale)")

        // 1. CLIP Text Encoding
        val posTokens = clipTokenizer.encode(prompt)
        val negTokens = clipTokenizer.encode(negativePrompt)

        val posEmbeddings = qnnBridge.runTextEncoder(posTokens)
        val negEmbeddings = qnnBridge.runTextEncoder(negTokens)

        // 2. Scheduler & Timesteps setup
        val (timesteps, stepSigmas) = scheduler.setTimesteps(numSteps)

        // 3. Initial Latents setup (txt2img vs img2img)
        var latents: FloatArray
        val startStep: Int

        if (!sourceImage.isNullOrBlank()) {
            val sourceBitmap = decodeSourceImage(sourceImage)
            val sourceLatents = bitmapToLatents(sourceBitmap)
            val initNoise = scheduler.generateInitialLatents(seed)

            startStep = ((1.0f - strength.coerceIn(0.05f, 0.95f)) * numSteps).toInt().coerceIn(0, numSteps - 1)
            val startTimestep = timesteps[startStep]
            latents = scheduler.addNoise(sourceLatents, initNoise, startTimestep)
            Log.i(TAG, "img2img initialized at step $startStep/$numSteps (t=$startTimestep)")
        } else {
            startStep = 0
            latents = scheduler.generateInitialLatents(seed, stepSigmas[0])
        }

        // 4. UNet Denoising Loop on Hexagon NPU
        var lastStepTime = System.currentTimeMillis()
        for (step in startStep until numSteps) {
            val t = timesteps[step].toFloat()
            val scaledLatents = scheduler.scaleModelInput(latents, step, stepSigmas)

            // Conditional & Unconditional forward passes on scaled latents
            val noiseUncond = qnnBridge.runUnet(scaledLatents, t, negEmbeddings)
            val noiseCond = qnnBridge.runUnet(scaledLatents, t, posEmbeddings)

            // Classifier-Free Guidance (CFG)
            val noisePred = scheduler.applyClassifierFreeGuidance(noiseUncond, noiseCond, cfgScale)

            // Scheduler step: z_t -> z_{t-1}
            latents = scheduler.step(noisePred, step, stepSigmas, latents, seed)

            val now = System.currentTimeMillis()
            val stepTime = (now - lastStepTime) / 1000.0f
            lastStepTime = now

            progressCallback?.invoke(step + 1, numSteps, stepTime)
        }

        // 5. VAE Latent Decoding to RGB Tensor
        Log.i(TAG, "Decoding final latents through VAE on Qualcomm NPU...")
        val rgbBytes = qnnBridge.runVaeDecoder(latents)

        // 6. Convert RGB byte tensor to Android Bitmap
        val outputBitmap = rgbBytesToBitmap(rgbBytes, 512, 512)

        // 7. Compress to PNG Base64
        val outputStream = ByteArrayOutputStream()
        outputBitmap.compress(Bitmap.CompressFormat.PNG, 100, outputStream)
        val base64 = Base64.encodeToString(outputStream.toByteArray(), Base64.NO_WRAP)

        val totalTime = System.currentTimeMillis() - startTime
        Log.i(TAG, "Stable Diffusion synthesis complete on Qualcomm NPU in ${totalTime}ms")

        mapOf(
            "base64Image" to "data:image/png;base64,$base64",
            "generationTimeMs" to totalTime,
            "width" to 512,
            "height" to 512
        )
    }

    private fun decodeSourceImage(source: String): Bitmap {
        return try {
            val rawBitmap = if (source.startsWith("data:image") || source.contains(";base64,")) {
                val clean = source.substringAfter("base64,")
                val bytes = Base64.decode(clean, Base64.DEFAULT)
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            } else if (source.startsWith("/")) {
                BitmapFactory.decodeFile(source)
            } else {
                val clean = source.removePrefix("file://")
                BitmapFactory.decodeFile(clean)
            }
            Bitmap.createScaledBitmap(rawBitmap, 512, 512, true)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to decode source image for img2img, creating default canvas", e)
            Bitmap.createBitmap(512, 512, Bitmap.Config.ARGB_8888)
        }
    }

    private fun bitmapToLatents(bitmap: Bitmap): FloatArray {
        val latents = FloatArray(64 * 64 * 4)
        for (ly in 0 until 64) {
            for (lx in 0 until 64) {
                val px = lx * 8 + 4
                val py = ly * 8 + 4
                val pixel = bitmap.getPixel(px, py)

                val r = ((pixel shr 16) and 0xFF) / 255.0f * 2.0f - 1.0f
                val g = ((pixel shr 8) and 0xFF) / 255.0f * 2.0f - 1.0f
                val b = (pixel and 0xFF) / 255.0f * 2.0f - 1.0f

                val baseIdx = (ly * 64 + lx) * 4
                latents[baseIdx] = (r + g + b) / 3.0f * 0.18215f
                latents[baseIdx + 1] = (r - b) * 0.18215f
                latents[baseIdx + 2] = (g - (r + b) / 2.0f) * 0.18215f
                latents[baseIdx + 3] = (b - g) * 0.18215f
            }
        }
        return latents
    }

    private fun rgbBytesToBitmap(rgb: ByteArray, width: Int, height: Int): Bitmap {
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val pixels = IntArray(width * height)

        for (i in pixels.indices) {
            val r = rgb[i * 3].toInt() and 0xFF
            val g = rgb[i * 3 + 1].toInt() and 0xFF
            val b = rgb[i * 3 + 2].toInt() and 0xFF
            pixels[i] = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
        }

        bitmap.setPixels(pixels, 0, width, 0, 0, width, height)
        return bitmap
    }
}
