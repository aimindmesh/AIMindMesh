package com.aimindmesh.mobile.genie

import android.content.Context
import android.net.Uri
import android.os.PowerManager
import android.util.Log
import com.geniex.sdk.GenieXSdk
import com.geniex.sdk.LlmWrapper
import com.geniex.sdk.VlmWrapper
import com.geniex.sdk.bean.ComputeUnitValue
import com.geniex.sdk.bean.GenerationConfig
import com.geniex.sdk.bean.LlmCreateInput
import com.geniex.sdk.bean.LlmStreamResult
import com.geniex.sdk.bean.ModelConfig
import com.geniex.sdk.bean.ProfilingData
import com.geniex.sdk.bean.RuntimeIdValue
import com.geniex.sdk.bean.SamplerConfig
import com.geniex.sdk.bean.VlmCreateInput
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.File
import java.io.FileInputStream
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/** A streamed piece of the answer; the last one (`done`) carries GenieX's timings when available */
data class GenieChunk(val text: String, val done: Boolean, val profile: ProfilingData? = null)

class GenieEngine(private val context: Context) {
    companion object {
        private const val TAG = "GenieEngine"
        private var isInitialized = false
        private var activeModelPath: String? = null
        /** "qairt" (AI Hub bundle) or "llama_cpp" (GGUF file), and the compute unit it runs on */
        private var activeRuntime: String? = null
        private var activeUnit: String? = null
        private var activeContext = 0
        private var activeModelMetadata: Map<String, Any?> = emptyMap()
        /** Whether the loaded QAIRT bundle takes a SamplerConfig (null: not tried yet) */
        private var qairtSampler: Boolean? = null
        private var llmWrapper: LlmWrapper? = null
        private var vlmWrapper: VlmWrapper? = null
        // Held by a generation for its whole duration: load/unload wait for it before destroying wrappers
        private val wrapperMutex = Mutex()
        /** One load or unload at a time: two activity instances loading together doubled the RAM and got the app killed */
        private val loadMutex = Mutex()
        /** GGUF: prompt of the last completed generation (what GenieX's prefix cache holds), and whether the cache is unreliable */
        private var cachedPrompt: String? = null
        private var cacheDirty = false
        private const val STOP_WAIT_MS = 15_000L
    }

    private val isGenerating = AtomicBoolean(false)
    private var abortRequested = AtomicBoolean(false)
    /** Incremented by each generation: a delayed stop only applies to the generation it was asked for */
    private val generationId = AtomicLong(0)

    private val wakeLock: PowerManager.WakeLock? by lazy {
        try {
            val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
            pm?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AIMindMesh:GenieNPUWakeLock")?.apply {
                setReferenceCounted(false)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to create WakeLock", e)
            null
        }
    }

    init {
        ensureGenieXInitialized()
    }

    private fun ensureGenieXInitialized() {
        try {
            GenieXSdk.getInstance().init(
                context,
                object : GenieXSdk.InitCallback {
                    override fun onSuccess() {
                        Log.i(TAG, "GenieXSdk initialized successfully on Snapdragon NPU")
                    }

                    override fun onFailure(reason: String) {
                        Log.w(TAG, "GenieXSdk init callback: $reason")
                    }
                }
            )

            val nativeLibDir = File(context.applicationInfo.nativeLibraryDir)
            if (nativeLibDir.exists() && nativeLibDir.isDirectory) {
                nativeLibDir.listFiles()?.forEach { libFile ->
                    if (libFile.name.startsWith("libgeniex_plugin_") && libFile.name.endsWith(".so")) {
                        try {
                            val res = GenieXSdk.getInstance().registerPlugin(libFile.absolutePath)
                            Log.i(TAG, "Registered plugin: ${libFile.name} -> $res")
                        } catch (e: Exception) {
                            Log.w(TAG, "Plugin registration exception for ${libFile.name}", e)
                        }
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "GenieXSdk initialization exception", e)
        }
    }

    fun detectNpuCapabilities(): Map<String, Any> = GenieConfigUtils.detectNpuCapabilities()

    /**
     * `runtime`: auto | npu | gpu | cpu. A `.gguf` runs on GenieX's llama_cpp runtime (NPU of any
     * Hexagon v68+, `auto` falling back to the GPU, then the CPU); anything else is a QAIRT bundle (NPU only).
     */
    suspend fun loadModel(modelPath: String, runtime: String = "auto", contextLength: Int? = null): Boolean =
        loadMutex.withLock { loadModelLocked(modelPath, runtime, contextLength) }

    private suspend fun loadModelLocked(
        modelPath: String,
        runtime: String,
        contextLength: Int?
    ): Boolean = withContext(Dispatchers.IO) {
        if (GgufSupport.isGguf(modelPath)) return@withContext loadGguf(modelPath, runtime, contextLength)
        if (isLoaded() && activeRuntime == RuntimeIdValue.QAIRT.value && activeModelPath != null && (activeModelPath == modelPath || File(modelPath).absolutePath == activeModelPath)) {
            Log.i(TAG, "Genie model already loaded: $activeModelPath")
            return@withContext true
        }
        ensureGenieXInitialized()
        wakeLock?.acquire(3 * 60 * 1000L)
        try {
            val isContentUri = modelPath.startsWith("content://")
            val fileName = GenieConfigUtils.getFileNameFromUri(context, modelPath)
            val bundleName = fileName.removeSuffix(".zip").replace("[^a-zA-Z0-9_.-]".toRegex(), "_")

            val targetDir = File(context.filesDir, "models/genie/$bundleName")
            var modelDir = GenieConfigUtils.findGenieModelDirectory(context, targetDir)

            if (modelDir == null) {
                if (isContentUri || fileName.endsWith(".zip") || (File(modelPath).exists() && File(modelPath).isFile)) {
                    Log.i(TAG, "Opening stream for $modelPath (file: $fileName)...")
                    val inputStream = if (isContentUri) {
                        context.contentResolver.openInputStream(Uri.parse(modelPath))
                    } else {
                        val file = File(modelPath)
                        if (file.exists()) FileInputStream(file) else null
                    }

                    if (inputStream == null) {
                        Log.e(TAG, "Failed to open input stream for model: $modelPath")
                        return@withContext false
                    }

                    val ok = GenieConfigUtils.extractZipStream(inputStream, targetDir)
                    if (!ok) {
                        Log.e(TAG, "Failed to extract bundle to $targetDir")
                        return@withContext false
                    }
                    modelDir = GenieConfigUtils.findGenieModelDirectory(context, targetDir)
                } else if (File(modelPath).exists()) {
                    modelDir = GenieConfigUtils.findGenieModelDirectory(context, File(modelPath))
                }
            }

            if (modelDir != null && modelDir != targetDir && modelDir.parentFile == targetDir) {
                try {
                    modelDir.listFiles()?.forEach { f ->
                        val dest = File(targetDir, f.name)
                        if (dest.exists()) dest.deleteRecursively()
                        f.renameTo(dest)
                    }
                    modelDir.delete()
                    modelDir = targetDir
                } catch (e: Exception) {
                    Log.w(TAG, "Directory flatten exception", e)
                }
            }

            if (modelDir == null) {
                Log.e(TAG, "Could not find valid genie_config.json in $targetDir for source: $modelPath")
                return@withContext false
            }

            if (activeModelPath == modelDir.absolutePath && isLoaded()) {
                return@withContext true
            }
            // Free the previous NPU model first: only one fits, and an overwritten wrapper is never destroyed
            if (!stopAndDestroyWrappers()) {
                Log.e(TAG, "Previous Genie generation did not stop; not loading $modelPath")
                return@withContext false
            }

            GenieConfigUtils.resolveGenieConfig(context, modelDir)
            activeModelMetadata = GenieConfigUtils.parseModelMetadata(modelDir) +
                mapOf("runtime" to RuntimeIdValue.QAIRT.value, "compute_unit" to "npu",
                    "context_length" to GenieConfigUtils.bundleContextSize(modelDir))
            activeModelPath = modelDir.absolutePath
            activeRuntime = RuntimeIdValue.QAIRT.value
            qairtSampler = null
            activeUnit = "npu"
            activeContext = 0

            val configFile = File(modelDir, "genie_config.json")
            val modelConfigPath = if (configFile.exists()) configFile.absolutePath else modelDir.absolutePath

            val isVision = activeModelMetadata["is_vision"] == true || File(modelDir, "vision_encoder.bin").exists()
            val tokenizerFile = File(modelDir, "tokenizer.json")

            try {
                if (isVision) {
                    val visionFile = if (File(modelDir, "vision_encoder.bin").exists()) File(modelDir, "vision_encoder.bin") else File(modelDir, "visual.bin")
                    val vlmInput = VlmCreateInput(
                        model_path = modelConfigPath,
                        mmproj_path = if (visionFile.exists()) visionFile.absolutePath else null,
                        config = ModelConfig(nCtx = 0, nGpuLayers = 0, nThreads = 8),
                        runtime_id = "qairt",
                        compute_unit = ComputeUnitValue.NPU.value
                    )
                    val res = VlmWrapper.builder().vlmCreateInput(vlmInput).build()
                    if (res.isSuccess) {
                        vlmWrapper = res.getOrNull()
                        llmWrapper = null
                        isInitialized = true
                        Log.i(TAG, "VlmWrapper successfully built on Qualcomm Hexagon NPU: ${activeModelMetadata["model_name"]}")
                    } else {
                        Log.w(TAG, "VlmWrapper build failed, falling back to LlmWrapper: ${res.exceptionOrNull()?.message}")
                        val llmInput = LlmCreateInput(
                            model_path = modelConfigPath,
                            tokenizer_path = if (tokenizerFile.exists()) tokenizerFile.absolutePath else null,
                            config = ModelConfig(nCtx = 0, nGpuLayers = 0),
                            runtime_id = "qairt",
                            compute_unit = ComputeUnitValue.NPU.value
                        )
                        val llmRes = LlmWrapper.builder().llmCreateInput(llmInput).build()
                        if (llmRes.isSuccess) {
                            llmWrapper = llmRes.getOrNull()
                            vlmWrapper = null
                            isInitialized = true
                            Log.i(TAG, "LlmWrapper fallback successfully built on Qualcomm Hexagon NPU: ${activeModelMetadata["model_name"]}")
                        } else {
                            Log.e(TAG, "Failed to build LlmWrapper fallback: ${llmRes.exceptionOrNull()?.message}")
                            return@withContext false
                        }
                    }
                } else {
                    val llmInput = LlmCreateInput(
                        model_path = modelConfigPath,
                        tokenizer_path = if (tokenizerFile.exists()) tokenizerFile.absolutePath else null,
                        config = ModelConfig(nCtx = 0, nGpuLayers = 0),
                        runtime_id = "qairt",
                        compute_unit = ComputeUnitValue.NPU.value
                    )
                    val res = LlmWrapper.builder().llmCreateInput(llmInput).build()
                    if (res.isSuccess) {
                        llmWrapper = res.getOrNull()
                        vlmWrapper = null
                        isInitialized = true
                        Log.i(TAG, "LlmWrapper successfully built on Qualcomm Hexagon NPU: ${activeModelMetadata["model_name"]}")
                    } else {
                        Log.e(TAG, "Failed to build LlmWrapper: ${res.exceptionOrNull()?.message}")
                        return@withContext false
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Exception creating Qualcomm wrapper instance", e)
                return@withContext false
            }

            Log.i(TAG, "QAIRT model loaded on the Hexagon NPU: ${activeModelMetadata["model_name"]} at ${modelDir.absolutePath}")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load Genie model", e)
            false
        } finally {
            if (wakeLock?.isHeld == true) {
                try { wakeLock?.release() } catch (e: Exception) {}
            }
        }
    }

    /** GGUF on llama_cpp: each unit of `runtime` in turn until one builds (the NPU first for `auto`) */
    private suspend fun loadGguf(modelPath: String, runtime: String, contextLength: Int?): Boolean {
        val file = GgufSupport.resolve(context.filesDir, modelPath)
        if (file == null) {
            Log.e(TAG, "GGUF model not found: $modelPath")
            return false
        }
        val nCtx = GgufSupport.contextFor(contextLength)
        if (isLoaded() && activeModelPath == file.absolutePath && activeContext == nCtx && GgufSupport.unitSatisfies(runtime, activeUnit)) {
            return true
        }
        ensureGenieXInitialized()
        wakeLock?.acquire(3 * 60 * 1000L)
        try {
            if (!stopAndDestroyWrappers()) {
                Log.e(TAG, "Previous Genie generation did not stop; not loading $modelPath")
                return false
            }
            val units = GgufSupport.unitsFor(runtime, GgufSupport.npuReady(file.name))
            for (unit in units) {
                val input = LlmCreateInput(
                    model_path = file.absolutePath,
                    config = ModelConfig(nCtx = nCtx, nGpuLayers = GgufSupport.gpuLayersFor(unit)),
                    runtime_id = RuntimeIdValue.LLAMA_CPP.value,
                    compute_unit = unit
                )
                val result = try {
                    LlmWrapper.builder().llmCreateInput(input).build()
                } catch (e: Exception) {
                    Result.failure(e)
                }
                val wrapper = result.getOrNull()
                if (wrapper == null) {
                    Log.w(TAG, "GGUF ${file.name} did not load on $unit: ${result.exceptionOrNull()?.message}")
                    continue
                }
                llmWrapper = wrapper
                vlmWrapper = null
                isInitialized = true
                activeModelPath = file.absolutePath
                activeRuntime = RuntimeIdValue.LLAMA_CPP.value
                activeUnit = unit
                activeContext = nCtx
                cachedPrompt = null
                cacheDirty = false
                activeModelMetadata = mapOf(
                    "model_id" to file.nameWithoutExtension,
                    "model_name" to file.nameWithoutExtension,
                    "precision" to (GgufSupport.weightFormat(file.name) ?: "gguf"),
                    "runtime" to RuntimeIdValue.LLAMA_CPP.value,
                    "compute_unit" to unit,
                    "context_length" to nCtx,
                    "is_vision" to false
                )
                Log.i(TAG, "GGUF ${file.name} loaded with llama_cpp on $unit (n_ctx $nCtx)")
                return true
            }
            Log.e(TAG, "GGUF ${file.name} did not load on any of $units")
            return false
        } finally {
            if (wakeLock?.isHeld == true) {
                try { wakeLock?.release() } catch (e: Exception) {}
            }
        }
    }

    /** QAIRT bundles in models/genie, and the GGUF files the model downloader saved in filesDir */
    suspend fun listLocalModels(): List<Map<String, Any?>> = withContext(Dispatchers.IO) {
        val models = mutableListOf<Map<String, Any?>>()
        val modelsRoot = File(context.filesDir, "models/genie")
        if (modelsRoot.exists() && modelsRoot.isDirectory) {
            modelsRoot.listFiles()?.forEach { file ->
                val modelDir = GenieConfigUtils.findGenieModelDirectory(context, file)
                if (modelDir != null) {
                    val meta = GenieConfigUtils.parseModelMetadata(modelDir).toMutableMap()
                    meta["path"] = modelDir.absolutePath
                    meta["sizeBytes"] = GenieConfigUtils.getFolderSize(modelDir)
                    meta["runtime"] = RuntimeIdValue.QAIRT.value
                    meta["npuReady"] = true
                    models.add(meta)
                }
            }
        }
        context.filesDir.listFiles()
            ?.filter { it.isFile && GgufSupport.isGguf(it.name) && !it.name.lowercase().contains("mmproj") }
            ?.sortedBy { it.name.lowercase() }
            ?.forEach { file ->
                models.add(mapOf(
                    "model_id" to file.nameWithoutExtension,
                    "model_name" to file.nameWithoutExtension,
                    "path" to file.absolutePath,
                    "precision" to (GgufSupport.weightFormat(file.name) ?: "gguf"),
                    "runtime" to RuntimeIdValue.LLAMA_CPP.value,
                    "npuReady" to GgufSupport.npuReady(file.name),
                    "is_vision" to false,
                    "sizeBytes" to file.length()
                ))
            }
        models
    }

    /** Prompt from the loaded model's own chat template (null if it has none: the app formats it) */
    suspend fun formatChat(turns: List<GenieTurn>, enableThinking: Boolean, toolsJson: String? = null): String? =
        wrapperMutex.withLock { GenieChat.format(llmWrapper, vlmWrapper, turns, enableThinking, toolsJson) }

    fun isLoaded(): Boolean = isInitialized && (llmWrapper != null || vlmWrapper != null)

    fun getActiveModelPath(): String? = activeModelPath

    fun getActiveModelMetadata(): Map<String, Any?> = activeModelMetadata

    fun getActiveRuntime(): String? = activeRuntime

    fun getActiveUnit(): String? = activeUnit

    suspend fun unloadModel(): Boolean = loadMutex.withLock { withContext(Dispatchers.IO) {
        try {
            val ok = stopAndDestroyWrappers()
            if (ok) Log.i(TAG, "Genie model unloaded successfully")
            ok
        } catch (e: Exception) {
            Log.e(TAG, "Failed to unload Genie model", e)
            false
        }
    } }

    /**
     * Stops a running stream synchronously, waits for the generation to release the wrappers,
     * then destroys them. Returns false (nothing destroyed) if the generation does not stop.
     */
    private suspend fun stopAndDestroyWrappers(): Boolean {
        if (llmWrapper == null && vlmWrapper == null) return true
        requestStop()
        val destroyed = withTimeoutOrNull(STOP_WAIT_MS) {
            wrapperMutex.withLock {
                try {
                    vlmWrapper?.destroy()
                } catch (e: Exception) {
                    Log.w(TAG, "Error destroying VlmWrapper", e)
                }
                try {
                    llmWrapper?.destroy()
                } catch (e: Exception) {
                    Log.w(TAG, "Error destroying LlmWrapper", e)
                }
                vlmWrapper = null
                llmWrapper = null
                activeModelPath = null
                activeModelMetadata = emptyMap()
                activeRuntime = null
                activeUnit = null
                activeContext = 0
                cachedPrompt = null
                cacheDirty = false
                isInitialized = false
                true
            }
        }
        return destroyed == true
    }

    /** `target`: generation to stop; null stops whatever runs (unload). */
    private suspend fun requestStop(target: Long? = null) {
        // The stop ran late and a new generation (e.g. the next chat turn) has started: leave it alone
        if (target != null && generationId.get() != target) return
        abortRequested.set(true)
        try {
            vlmWrapper?.stopStream()
            llmWrapper?.stopStream()
        } catch (e: Exception) {
            Log.w(TAG, "Error stopping stream", e)
        }
    }

    fun abortGeneration(): Boolean {
        val target = generationId.get()
        abortRequested.set(true)
        // stopStream may block briefly: keep it off the caller's thread
        kotlinx.coroutines.CoroutineScope(Dispatchers.IO).launch { requestStop(target) }
        return true
    }

    fun generateStream(
        prompt: String,
        maxTokens: Int = 2048,
        temperature: Float = 0.7f,
        topP: Float = 0.9f,
        stopSequences: List<String> = emptyList(),
        imagePaths: List<String> = emptyList(),
        grammar: String? = null
    ): Flow<GenieChunk> = flow {
        wrapperMutex.withLock {
        if (!isLoaded() || (llmWrapper == null && vlmWrapper == null)) {
            throw IllegalStateException("Genie NPU model is not loaded")
        }

        generationId.incrementAndGet()
        abortRequested.set(false)
        isGenerating.set(true)
        wakeLock?.acquire(5 * 60 * 1000L)

        val llamaCpp = activeRuntime == RuntimeIdValue.LLAMA_CPP.value
        try {
            Log.i(TAG, "Starting $activeRuntime generation on $activeUnit, prompt length: ${prompt.length}, images: ${imagePaths.size}")
            if (llamaCpp && GgufSupport.mustResetBefore(cachedPrompt, cacheDirty, prompt)) {
                resetGgufCache(if (cacheDirty) "last generation did not complete" else "prompt does not continue the last one")
            }
            cacheDirty = llamaCpp // until this generation completes
            // GGUFs take the app's sampling (and grammar); QAIRT bundles too, unless GenieX
            // refused it once for this bundle (then their genie_config.json sampling applies)
            var useSampler = llamaCpp || qairtSampler != false
            fun configFor(sampler: Boolean) = GenerationConfig(
                maxTokens = if (maxTokens > 0) maxTokens else 2048,
                stopWords = if (stopSequences.isNotEmpty()) stopSequences.toTypedArray() else null,
                stopCount = stopSequences.size,
                samplerConfig = if (sampler) samplerFor(temperature, topP, if (llamaCpp) grammar else null) else null,
                // Vision models fill the prompt's image slots with these files, in order
                imagePaths = if (vlmWrapper != null && imagePaths.isNotEmpty()) imagePaths.toTypedArray() else null,
                imageCount = if (vlmWrapper != null) imagePaths.size else 0
            )
            var config = configFor(useSampler)
            var retried = false
            while (true) {
                var emitted = false
                var overflow = false
                var samplerRefused = false
                val stream = vlmWrapper?.generateStreamFlow(prompt, config)
                    ?: llmWrapper!!.generateStreamFlow(prompt, config)
                stream.collect { streamResult ->
                    if (abortRequested.get()) {
                        vlmWrapper?.stopStream()
                        llmWrapper?.stopStream()
                        return@collect
                    }
                    when (streamResult) {
                        is LlmStreamResult.Token -> {
                            emitted = true
                            emit(GenieChunk(streamResult.text, false))
                        }
                        is LlmStreamResult.Completed -> {
                            streamResult.profile?.let {
                                Log.i(TAG, "Profile ($activeUnit): TTFT ${it.ttftMs.toInt()} ms, prefill ${it.promptTokens} tok at " +
                                    "${"%.1f".format(it.prefillSpeed)} tok/s, decode ${it.generatedTokens} tok at ${"%.1f".format(it.decodingSpeed)} tok/s" +
                                    if (it.mediaMs > 0) ", images encoded in ${it.mediaMs.toInt()} ms" else "")
                            }
                            if (llamaCpp) {
                                cachedPrompt = prompt
                                cacheDirty = false
                            } else if (useSampler && qairtSampler == null) {
                                qairtSampler = true
                                Log.i(TAG, "QAIRT bundle accepts the app's sampling")
                            }
                            emit(GenieChunk("", true, streamResult.profile))
                        }
                        is LlmStreamResult.Error -> {
                            val err = streamResult.throwable.message ?: streamResult.throwable.toString()
                            if (llamaCpp && !retried && !emitted && GgufSupport.isContextOverflow(err)) {
                                overflow = true
                            } else if (!llamaCpp && useSampler && qairtSampler == null && !emitted) {
                                samplerRefused = true
                            } else {
                                Log.e(TAG, "Stream error: $err")
                                throw RuntimeException("Genie generation failed: $err")
                            }
                        }
                    }
                }
                if (samplerRefused) {
                    Log.w(TAG, "QAIRT bundle refused the app's sampling: using its genie_config.json")
                    qairtSampler = false
                    useSampler = false
                    config = configFor(false)
                    continue
                }
                if (!overflow) break
                // Safety net for the GenieX cache bug: clear it and run the prompt once more from scratch
                retried = true
                resetGgufCache("GenieX reported a context overflow")
            }
        } finally {
            isGenerating.set(false)
            if (wakeLock?.isHeld == true) {
                try { wakeLock?.release() } catch (e: Exception) {}
            }
        }
        }
    }.flowOn(Dispatchers.IO)

    /** Clears GenieX's KV cache and token list (see GgufSupport.mustResetBefore) */
    private suspend fun resetGgufCache(reason: String) {
        val code = try { llmWrapper?.reset() } catch (e: Exception) { Log.w(TAG, "GGUF cache reset failed", e); null }
        cachedPrompt = null
        Log.i(TAG, "GGUF cache reset ($reason): $code")
    }

    /** llama.cpp defaults for top-k / min-p, no repetition penalty, a fresh seed per answer */
    private fun samplerFor(temperature: Float, topP: Float, grammar: String?) = SamplerConfig(
        temperature = temperature,
        topP = topP,
        topK = 40,
        minP = 0.05f,
        repetitionPenalty = 1.0f,
        seed = (System.nanoTime() and 0x7fffffff).toInt(),
        grammarString = grammar?.takeIf { it.isNotBlank() }
    )
}
