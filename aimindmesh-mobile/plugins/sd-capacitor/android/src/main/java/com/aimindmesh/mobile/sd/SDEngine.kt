package com.aimindmesh.mobile.sd

import android.content.Context
import android.os.Build
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.util.Random

data class SDRequest(
    val prompt: String,
    val negativePrompt: String = "",
    /** Image to edit (img2img): data URL, base64, file path or content:// URI */
    val sourceImage: String? = null,
    val strength: Float = 0.65f,
    val steps: Int = 25,
    val cfgScale: Float = 7.5f,
    /** -1: random (the seed actually used is returned) */
    val seed: Long = -1,
    val aspectRatio: String = "1:1",
    val upscale: Int = 1,
    val sampler: SamplerKind = SamplerKind.EULER
)

/**
 * Stable Diffusion on the Qualcomm Hexagon NPU: CLIP text encoder, UNet denoising loop and VAE
 * decoding, plus img2img (VAE encoder) and Real-ESRGAN upscaling when the package has them.
 */
class SDEngine(private val context: Context) {
    companion object {
        private const val TAG = "SDEngine"
        private const val PREFS = "sd_engine"
        // The QNN pipeline is a native singleton: its state is process-wide like the engine
        private var isInitialized = false
        private var activeModelDir: String? = null
        private var modelInfo = SDModelInfo()
        private var predictionType = PredictionType.V_PREDICTION
        /** Embedding of the empty prompt: the reference for prompt weights */
        private var emptyEmbedding: FloatArray? = null
        // load/unload/generate must not overlap
        private val pipelineMutex = Mutex()
    }

    private val clipTokenizer by lazy { ClipTokenizer.fromAssets(context) }
    private val scheduler = DiffusionScheduler()
    private val qnnBridge = QnnNativeBridge(context)

    /** SD 1.x (768-dim CLIP) pads prompts with the end token, SD 2.x (OpenCLIP) with "!" */
    private val padToken get() = if (modelInfo.embedDim == 768) ClipTokenizer.END_TOKEN_ID else ClipTokenizer.SD2_PAD_TOKEN_ID

    fun detectCapabilities(): Map<String, Any> {
        val hardware = Build.HARDWARE.lowercase()
        val board = Build.BOARD.lowercase()
        val soc = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) Build.SOC_MODEL.lowercase() else ""
        val isSnapdragon8Elite = hardware.contains("qcom") && (board.contains("sun") || soc.contains("sm8750") || hardware.contains("sm8750"))
        val isSnapdragon8Gen3 = hardware.contains("qcom") && (board.contains("pineapple") || soc.contains("sm8650") || hardware.contains("sm8650"))
        val hasNpu = isSnapdragon8Elite || isSnapdragon8Gen3 || hardware.contains("qcom")
        val npuArch = when {
            isSnapdragon8Elite -> "v79"
            isSnapdragon8Gen3 -> "v75"
            hardware.contains("qcom") -> "v73"
            else -> "none"
        }
        return mapOf(
            "hasNpu" to hasNpu,
            "npuArch" to npuArch,
            "supportedBackends" to if (hasNpu) listOf("cpu", "gpu", "npu") else listOf("cpu"),
            "socModel" to soc.ifEmpty { Build.HARDWARE }
        )
    }

    /** Loads a package directory (text_encoder.bin, unet.bin, vae.bin, optional vae_encoder.bin / realesrgan_x4plus.bin). */
    suspend fun loadModel(modelPath: String, backend: String = "npu"): Boolean = withContext(Dispatchers.IO) {
        pipelineMutex.withLock { loadModelLocked(modelPath, backend) }
    }

    private fun resolveModelDir(modelPath: String): File? {
        val cleanPath = modelPath.removePrefix("file://").trim()
        val sdDir = File(context.filesDir, "sd-models")
        val dir = listOf(File(cleanPath), File(context.filesDir, cleanPath), File(sdDir, cleanPath), File(sdDir, File(cleanPath).name))
            .firstOrNull { it.exists() } ?: return null
        return SDFileUtils.findSDModelDirectory(dir) ?: dir
    }

    private fun loadModelLocked(modelPath: String, backend: String): Boolean {
        return try {
            val dir = resolveModelDir(modelPath)
            if (dir == null) {
                Log.e(TAG, "SD model path does not exist: $modelPath")
                return false
            }
            Log.i(TAG, "Loading Stable Diffusion QNN pipeline on $backend from ${dir.absolutePath}")
            emptyEmbedding = null
            // nativeInit releases any previous pipeline first; report its real outcome
            val ready = qnnBridge.initializeFromDirectory(dir)
            isInitialized = ready
            activeModelDir = if (ready) dir.absolutePath else null
            if (!ready) {
                Log.e(TAG, "QNN pipeline init failed (text_encoder/unet/vae .bin missing, inconsistent or unsupported NPU)")
                return false
            }
            modelInfo = qnnBridge.modelInfo()
            predictionType = resolvePredictionType(dir)
            Log.i(TAG, "Model ready: $modelInfo, prediction=${predictionType.id}")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load SD model", e)
            isInitialized = false
            activeModelDir = null
            false
        }
    }

    /** metadata.json "prediction_type", else a cached or fresh probe, else the SD 2.x 768-v default. */
    private fun resolvePredictionType(dir: File): PredictionType {
        val meta = File(dir, "metadata.json")
        if (meta.isFile) {
            try {
                PredictionType.parse(JSONObject(meta.readText()).optString("prediction_type", ""))?.let {
                    Log.i(TAG, "Prediction type from metadata.json: ${it.id}")
                    return it
                }
            } catch (e: Exception) {
                Log.w(TAG, "Unreadable metadata.json", e)
            }
        }
        val unet = File(dir, "unet.bin")
        val key = "prediction:${dir.absolutePath}:${unet.length()}:${unet.lastModified()}"
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        PredictionType.parse(prefs.getString(key, null))?.let { return it }

        val fallback = if (modelInfo.embedDim == 768) PredictionType.EPSILON else PredictionType.V_PREDICTION
        val probed = try {
            val t = minOf(PredictionTypeProbe.PROBE_TIMESTEP, modelInfo.timestepMax)
            val noise = scheduler.noise(modelInfo.latentSize, Random(1234))
            val input = PredictionTypeProbe.probeInput(noise, scheduler.alphaCumprod(t))
            val output = qnnBridge.runUnet(input, t.toFloat(), emptyPromptEmbedding())
            val corr = PredictionTypeProbe.correlation(output, noise)
            PredictionTypeProbe.decide(output, noise).also {
                Log.i(TAG, "Prediction probe at t=$t: correlation=${"%.3f".format(corr)} -> ${it?.id ?: "undetermined"}")
            }
        } catch (e: Exception) {
            Log.w(TAG, "Prediction probe failed", e)
            null
        }
        if (probed != null) prefs.edit().putString(key, probed.id).apply()
        return probed ?: fallback
    }

    private fun emptyPromptEmbedding(): FloatArray =
        emptyEmbedding ?: qnnBridge.runTextEncoder(clipTokenizer.encode("", padToken)).also { emptyEmbedding = it }

    fun isLoaded(): Boolean = isInitialized && activeModelDir != null && qnnBridge.isReady()

    fun getActiveModelPath(): String? = activeModelDir

    fun getModelInfo(): SDModelInfo = modelInfo

    fun getPredictionType(): PredictionType = predictionType

    suspend fun unloadModel(): Boolean = withContext(Dispatchers.IO) {
        pipelineMutex.withLock {
            try {
                // Frees the QNN contexts (GBs of NPU/native memory), not just the flags
                qnnBridge.release()
                activeModelDir = null
                isInitialized = false
                emptyEmbedding = null
                Log.i(TAG, "SD QNN engine unloaded")
                true
            } catch (e: Exception) {
                Log.e(TAG, "Failed to unload SD model", e)
                false
            }
        }
    }

    private fun encodePrompt(text: String): Pair<FloatArray, Boolean> {
        val tokenized = clipTokenizer.encodeWithWeights(text, padToken)
        val embedding = qnnBridge.runTextEncoder(tokenized.tokens)
        if (PromptWeighting.needsWeighting(tokenized.weights)) {
            PromptWeighting.apply(embedding, tokenized.weights, emptyPromptEmbedding(), modelInfo.embedDim)
        }
        return embedding to tokenized.truncated
    }

    /** Generates (or, with a source image, edits) an image on the Hexagon NPU. */
    suspend fun generateImage(
        request: SDRequest,
        progressCallback: ((step: Int, totalSteps: Int, timePerStep: Float) -> Unit)? = null
    ): Map<String, Any> = withContext(Dispatchers.IO) { pipelineMutex.withLock {
        if (!isLoaded() || activeModelDir == null) {
            throw IllegalStateException("No Stable Diffusion model loaded. Please import and select a model in Settings > Vision & Image Creation.")
        }
        val startTime = System.currentTimeMillis()
        val info = modelInfo
        val numSteps = request.steps.coerceIn(1, 100)
        val seed = if (request.seed >= 0) request.seed else Random().nextInt(Int.MAX_VALUE).toLong()
        val random = Random(seed)
        val editing = !request.sourceImage.isNullOrBlank()
        Log.i(TAG, "SD ${if (editing) "img2img (strength ${request.strength})" else "txt2img"}: '${request.prompt}' | neg '${request.negativePrompt}' " +
            "| steps $numSteps, cfg ${request.cfgScale}, seed $seed, ${request.sampler.id}, ${predictionType.id}, ratio ${request.aspectRatio}, upscale ${request.upscale}x")

        // 1. Text conditioning (the negative prompt is the unconditional branch of CFG)
        val (condEmbedding, truncated) = encodePrompt(request.prompt)
        val useCfg = request.cfgScale > 1.0f
        val uncondEmbedding = if (useCfg) encodePrompt(request.negativePrompt).first else null

        // 2. Schedule within the timestep range the UNet was calibrated for
        val timesteps = scheduler.timesteps(numSteps, info.timestepMax)
        val sigmas = scheduler.sigmas(timesteps)

        // 3. Starting latent: pure noise, or the source image noised to the strength's level
        var latents: FloatArray
        var startIndex = 0
        var outputRect = SDGeometry.aspectCrop(info.imageWidth, request.aspectRatio)
        if (editing) {
            if (!qnnBridge.hasVaeEncoder()) {
                throw IllegalStateException("This Stable Diffusion package has no vae_encoder.bin, so it cannot edit images")
            }
            val source = SDImageOps.decodeSource(context, request.sourceImage!!)
            val (rgb, placement) = SDImageOps.prepareForEditing(source, info.imageWidth)
            outputRect = placement // the result keeps the source's proportions
            val sourceLatents = qnnBridge.runVaeEncoder(rgb)
            startIndex = scheduler.img2imgStartIndex(numSteps, request.strength)
            latents = scheduler.addNoise(sourceLatents, scheduler.noise(info.latentSize, random), sigmas[startIndex])
        } else {
            val scale = scheduler.initNoiseScale(sigmas[0])
            latents = scheduler.noise(info.latentSize, random).let { n -> FloatArray(n.size) { i -> (n[i] * scale).toFloat() } }
        }

        // 4. Denoising loop on the NPU
        val sampler = scheduler.sampler(request.sampler)
        val totalSteps = numSteps - startIndex
        var lastStepTime = System.currentTimeMillis()
        for (i in startIndex until numSteps) {
            val sigma = sigmas[i]
            val input = scheduler.scaleModelInput(latents, sigma)
            val t = timesteps[i].toFloat()
            val cond = qnnBridge.runUnet(input, t, condEmbedding)
            val output = if (uncondEmbedding != null) {
                scheduler.guidance(qnnBridge.runUnet(input, t, uncondEmbedding), cond, request.cfgScale)
            } else cond
            val denoised = scheduler.denoised(latents, output, sigma, predictionType)
            latents = sampler.step(latents, denoised, sigma, sigmas[i + 1])

            val now = System.currentTimeMillis()
            progressCallback?.invoke(i - startIndex + 1, totalSteps, (now - lastStepTime) / 1000.0f)
            lastStepTime = now
        }

        // 5. Decode, upscale the whole square, then crop to the requested (or source) shape
        val square = SDImageOps.rgbToBitmap(qnnBridge.runVaeDecoder(latents), info.imageWidth, info.imageHeight)
        val upscale = request.upscale.coerceIn(1, 4)
        val output = SDImageOps.upscaleAndCrop(square, outputRect, upscale, qnnBridge::runSuperResolution,
            info.superResolutionWidth, info.superResolutionHeight)
        val dataUrl = SDImageOps.toDataUrl(output)

        val totalTime = System.currentTimeMillis() - startTime
        Log.i(TAG, "Stable Diffusion done in ${totalTime}ms (${output.width}x${output.height})")
        mapOf(
            "base64Image" to dataUrl,
            "generationTimeMs" to totalTime,
            "width" to output.width,
            "height" to output.height,
            "steps" to numSteps,
            "seed" to seed,
            "aspectRatio" to if (editing) "source" else request.aspectRatio,
            "upscale" to upscale,
            "sampler" to request.sampler.id,
            "predictionType" to predictionType.id,
            "promptTruncated" to truncated
        )
    } }
}
