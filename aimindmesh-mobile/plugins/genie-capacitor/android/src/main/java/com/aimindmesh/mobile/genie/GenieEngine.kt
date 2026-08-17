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
import com.geniex.sdk.bean.VlmCreateInput
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileInputStream
import java.util.concurrent.atomic.AtomicBoolean

class GenieEngine(private val context: Context) {
    companion object {
        private const val TAG = "GenieEngine"
        private var isInitialized = false
        private var activeModelPath: String? = null
        private var activeModelMetadata: Map<String, Any?> = emptyMap()
        private var llmWrapper: LlmWrapper? = null
        private var vlmWrapper: VlmWrapper? = null
    }

    private val isGenerating = AtomicBoolean(false)
    private var abortRequested = AtomicBoolean(false)

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

    suspend fun loadModel(
        modelPath: String,
        runtime: String = "npu",
        temperature: Float = 0.7f,
        topP: Float = 0.9f
    ): Boolean = withContext(Dispatchers.IO) {
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

            GenieConfigUtils.resolveGenieConfig(context, modelDir)
            activeModelMetadata = GenieConfigUtils.parseModelMetadata(modelDir)
            activeModelPath = modelDir.absolutePath

            val configFile = File(modelDir, "genie_config.json")
            val modelConfigPath = if (configFile.exists()) configFile.absolutePath else modelDir.absolutePath

            val isVision = activeModelMetadata["is_vision"] == true || File(modelDir, "vision_encoder.bin").exists()
            val tokenizerFile = File(modelDir, "tokenizer.json")

            try {
                if (isVision) {
                    val visionFile = if (File(modelDir, "vision_encoder.bin").exists()) File(modelDir, "vision_encoder.bin") else File(modelDir, "visual.bin")
                    val vlmInput = VlmCreateInput(
                        model_name = modelDir.name,
                        model_path = modelConfigPath,
                        mmproj_path = if (visionFile.exists()) visionFile.absolutePath else null,
                        config = ModelConfig(nCtx = 0, nGpuLayers = 0, nThreads = 8, enable_thinking = false),
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
                            model_name = modelDir.name,
                            model_path = modelConfigPath,
                            tokenizer_path = if (tokenizerFile.exists()) tokenizerFile.absolutePath else null,
                            config = ModelConfig(nCtx = 0, nGpuLayers = 0, enable_thinking = false),
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
                        model_name = modelDir.name,
                        model_path = modelConfigPath,
                        tokenizer_path = if (tokenizerFile.exists()) tokenizerFile.absolutePath else null,
                        config = ModelConfig(nCtx = 0, nGpuLayers = 0, enable_thinking = false),
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

            Log.i(TAG, "Model successfully loaded on Qualcomm Hexagon HTP ($runtime): ${activeModelMetadata["model_name"]} at ${modelDir.absolutePath}")
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
                    models.add(meta)
                }
            }
        }
        models
    }

    fun isLoaded(): Boolean = isInitialized && (llmWrapper != null || vlmWrapper != null)

    fun getActiveModelPath(): String? = activeModelPath

    fun getActiveModelMetadata(): Map<String, Any?> = activeModelMetadata

    suspend fun unloadModel(): Boolean = withContext(Dispatchers.IO) {
        try {
            abortGeneration()
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
            isInitialized = false
            Log.i(TAG, "Genie model unloaded successfully")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to unload Genie model", e)
            false
        }
    }

    fun abortGeneration(): Boolean {
        abortRequested.set(true)
        isGenerating.set(false)
        kotlinx.coroutines.CoroutineScope(Dispatchers.IO).launch {
            try {
                vlmWrapper?.stopStream()
                llmWrapper?.stopStream()
            } catch (e: Exception) {
                Log.w(TAG, "Error stopping stream", e)
            }
        }
        return true
    }

    fun generateStream(
        prompt: String,
        maxTokens: Int = 2048,
        temperature: Float = 0.7f,
        topP: Float = 0.9f,
        stopSequences: List<String> = emptyList()
    ): Flow<Pair<String, Boolean>> = flow {
        if (!isLoaded() || (llmWrapper == null && vlmWrapper == null)) {
            throw IllegalStateException("Genie NPU model is not loaded")
        }

        abortRequested.set(false)
        isGenerating.set(true)
        wakeLock?.acquire(5 * 60 * 1000L)

        try {
            Log.i(TAG, "Starting NPU generation with prompt length: ${prompt.length}")
            val config = GenerationConfig(
                maxTokens = if (maxTokens > 0) maxTokens else 2048,
                stopWords = if (stopSequences.isNotEmpty()) stopSequences.toTypedArray() else null,
                stopCount = stopSequences.size
            )

            if (vlmWrapper != null) {
                vlmWrapper!!.generateStreamFlow(prompt, config).collect { streamResult ->
                    if (abortRequested.get()) {
                        vlmWrapper?.stopStream()
                        return@collect
                    }
                    when (streamResult) {
                        is LlmStreamResult.Token -> {
                            emit(Pair(streamResult.text, false))
                        }
                        is LlmStreamResult.Completed -> {
                            emit(Pair("", true))
                        }
                        is LlmStreamResult.Error -> {
                            val err = streamResult.throwable.message ?: streamResult.throwable.toString()
                            Log.e(TAG, "VLM Stream error: $err")
                            throw RuntimeException("VLM generation failed: $err")
                        }
                    }
                }
            } else if (llmWrapper != null) {
                llmWrapper!!.generateStreamFlow(prompt, config).collect { streamResult ->
                    if (abortRequested.get()) {
                        llmWrapper?.stopStream()
                        return@collect
                    }
                    when (streamResult) {
                        is LlmStreamResult.Token -> {
                            emit(Pair(streamResult.text, false))
                        }
                        is LlmStreamResult.Completed -> {
                            emit(Pair("", true))
                        }
                        is LlmStreamResult.Error -> {
                            val err = streamResult.throwable.message ?: streamResult.throwable.toString()
                            Log.e(TAG, "LLM Stream error: $err")
                            throw RuntimeException("LLM generation failed: $err")
                        }
                    }
                }
            }
        } finally {
            isGenerating.set(false)
            if (wakeLock?.isHeld == true) {
                try { wakeLock?.release() } catch (e: Exception) {}
            }
        }
    }.flowOn(Dispatchers.IO)
}
