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
        aspectRatio: String = "1:1",
        upscale: Int = 1,
        progressCallback: ((step: Int, totalSteps: Int, timePerStep: Float) -> Unit)? = null
    ): Map<String, Any> = withContext(Dispatchers.IO) {
        if (!isLoaded() || activeModelDir == null) {
            throw IllegalStateException("No Stable Diffusion model loaded. Please import and select a model in Settings > Vision & Image Creation.")
        }

        val startTime = System.currentTimeMillis()
        val numSteps = steps.coerceIn(1, 100)
        val modeStr = if (sourceImage != null) "Image-to-Image (strength: $strength)" else "Text-to-Image"
        Log.i(TAG, "Starting on-device Qualcomm NPU synthesis [$modeStr]: '$prompt' | Neg: '$negativePrompt' (ratio: $aspectRatio, upscale: ${upscale}x, steps: $numSteps, cfg: $cfgScale)")

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
            val startSigma = stepSigmas[startStep]
            latents = scheduler.addNoise(sourceLatents, initNoise, startSigma)
            Log.i(TAG, "img2img initialized at step $startStep/$numSteps (t=$startTimestep, sigma=$startSigma)")
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

        // 6. Convert RGB byte tensor to Android Bitmap (512x512)
        var outputBitmap = rgbBytesToBitmap(rgbBytes, 512, 512)

        // 7. Apply Aspect Ratio Framing (1:1, 16:9, 9:16, 4:3, 3:4)
        if (aspectRatio != "1:1") {
            outputBitmap = applyAspectRatioFraming(outputBitmap, aspectRatio)
        }

        // 8. Apply AI Super-Resolution (Real-ESRGAN x4plus on Hexagon NPU)
        if (upscale > 1) {
            val srStart = System.currentTimeMillis()
            outputBitmap = applySuperResolution(outputBitmap, upscale)
            Log.i(TAG, "Super-Resolution ${upscale}x complete in ${System.currentTimeMillis() - srStart}ms -> ${outputBitmap.width}x${outputBitmap.height}")
        }

        // 9. Compress to PNG Base64
        val outputStream = ByteArrayOutputStream()
        outputBitmap.compress(Bitmap.CompressFormat.PNG, 100, outputStream)
        val base64 = Base64.encodeToString(outputStream.toByteArray(), Base64.NO_WRAP)

        val totalTime = System.currentTimeMillis() - startTime
        Log.i(TAG, "Stable Diffusion synthesis complete on Qualcomm NPU in ${totalTime}ms (final size: ${outputBitmap.width}x${outputBitmap.height})")

        mapOf(
            "base64Image" to "data:image/png;base64,$base64",
            "generationTimeMs" to totalTime,
            "width" to outputBitmap.width,
            "height" to outputBitmap.height,
            "steps" to numSteps,
            "seed" to seed,
            "aspectRatio" to aspectRatio,
            "upscale" to upscale
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

    /**
     * Encode a 512x512 Bitmap into SD latent space using the VAE Encoder NPU model.
     * Output: FloatArray of shape [1, 64, 64, 4] (NHWC), values in latent space.
     */
    private fun bitmapToLatents(bitmap: Bitmap): FloatArray {
        // Use the compiled VAE encoder on the Hexagon NPU
        if (qnnBridge.hasVaeEncoder()) {
            return try {
                val bmp512 = if (bitmap.width != 512 || bitmap.height != 512) {
                    Bitmap.createScaledBitmap(bitmap, 512, 512, true)
                } else {
                    bitmap
                }

                // Extract raw RGB bytes [512 * 512 * 3]
                val rgbBytes = ByteArray(512 * 512 * 3)
                val pixels = IntArray(512 * 512)
                bmp512.getPixels(pixels, 0, 512, 0, 0, 512, 512)
                for (i in pixels.indices) {
                    val px = pixels[i]
                    rgbBytes[i * 3]     = ((px shr 16) and 0xFF).toByte()
                    rgbBytes[i * 3 + 1] = ((px shr 8)  and 0xFF).toByte()
                    rgbBytes[i * 3 + 2] = (px           and 0xFF).toByte()
                }

                val latent = qnnBridge.runVaeEncoder(rgbBytes)
                if (latent != null && latent.size == 64 * 64 * 4) {
                    Log.i(TAG, "VAE Encoder succeeded: latent shape [1,64,64,4], sample[0]=${latent[0]}")
                    latent
                } else {
                    Log.e(TAG, "VAE Encoder returned null or wrong size (${latent?.size}), falling back to zeros")
                    FloatArray(64 * 64 * 4)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Exception in VAE Encoder, falling back to zeros", e)
                FloatArray(64 * 64 * 4)
            }
        } else {
            // VAE encoder not available - return zero latents (img2img won't work correctly)
            Log.w(TAG, "VAE encoder not loaded, using zero latents for img2img")
            return FloatArray(64 * 64 * 4)
        }
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

    private fun applyAspectRatioFraming(src: Bitmap, aspectRatio: String): Bitmap {
        val srcW = src.width
        val srcH = src.height

        val (targetW, targetH) = when (aspectRatio) {
            "16:9" -> Pair(srcW, (srcW * 9) / 16)       // 512 x 288
            "9:16" -> Pair((srcH * 9) / 16, srcH)       // 288 x 512
            "4:3"  -> Pair(srcW, (srcW * 3) / 4)        // 512 x 384
            "3:4"  -> Pair((srcH * 3) / 4, srcH)        // 384 x 512
            else   -> Pair(srcW, srcH)
        }

        val cropX = ((srcW - targetW) / 2).coerceAtLeast(0)
        val cropY = ((srcH - targetH) / 2).coerceAtLeast(0)
        return Bitmap.createBitmap(src, cropX, cropY, targetW, targetH)
    }

    private fun applySuperResolution(src: Bitmap, scaleFactor: Int): Bitmap {
        if (qnnBridge.hasSuperResolution()) {
            try {
                val inputSquare = if (src.width != 512 || src.height != 512) {
                    Bitmap.createScaledBitmap(src, 512, 512, true)
                } else {
                    src
                }

                val rgbBytes = ByteArray(512 * 512 * 3)
                val pixels = IntArray(512 * 512)
                inputSquare.getPixels(pixels, 0, 512, 0, 0, 512, 512)
                for (i in pixels.indices) {
                    val px = pixels[i]
                    rgbBytes[i * 3]     = ((px shr 16) and 0xFF).toByte()
                    rgbBytes[i * 3 + 1] = ((px shr 8)  and 0xFF).toByte()
                    rgbBytes[i * 3 + 2] = (px           and 0xFF).toByte()
                }

                val outRgb = qnnBridge.runSuperResolution(rgbBytes)
                if (outRgb != null && outRgb.size == 2048 * 2048 * 3) {
                    val out2048 = rgbBytesToBitmap(outRgb, 2048, 2048)
                    val finalW = src.width * scaleFactor
                    val finalH = src.height * scaleFactor
                    return if (finalW == 2048 && finalH == 2048) {
                        out2048
                    } else {
                        Bitmap.createScaledBitmap(out2048, finalW, finalH, true)
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "NPU Real-ESRGAN super-resolution exception, falling back to bicubic scaling", e)
            }
        }

        // Fallback high-quality bilinear/bicubic scaling
        val targetW = src.width * scaleFactor
        val targetH = src.height * scaleFactor
        return Bitmap.createScaledBitmap(src, targetW, targetH, true)
    }
}

