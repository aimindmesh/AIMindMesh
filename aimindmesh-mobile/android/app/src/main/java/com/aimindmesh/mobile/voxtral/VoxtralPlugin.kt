package com.aimindmesh.mobile.voxtral

import android.util.Log
import com.getcapacitor.*
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.*
import java.io.File

@CapacitorPlugin(name = "Voxtral")
class VoxtralPlugin : Plugin() {

    private var inferenceEngine: VoxtralInferenceEngine? = null
    private var audioProcessor: AudioStreamProcessor? = null
    private var isStreaming = false
    private var currentModelPath: String? = null  // Track loaded model path
    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())

    companion object {
        private const val TAG = "VoxtralPlugin"
    }

    /**
     * Initialize Voxtral model
     * @param modelPath: Path to .gguf file (e.g., Voxtral-Mini-4B-Realtime-Q4_K_M.gguf)
     * @param transcriptionDelayMs: Latency config (240, 480, 960, 2400)
     * @param maxModelLen: Context size (default 45000 for 1h meeting)
     * @param nThreads: CPU threads (default 4)
     */
    @PluginMethod
    fun initModel(call: PluginCall) {
        var modelPath = call.getString("modelPath") 
            ?: return call.reject("modelPath required")

        android.util.Log.i("VoxtralPlugin", "initModel called with path: $modelPath")

        // Resolve absolute path for model
        var modelFile = File(modelPath)
        if (!modelFile.isAbsolute) {
             modelFile = File(bridge.context.filesDir, modelPath)
             modelPath = modelFile.absolutePath
             android.util.Log.i("VoxtralPlugin", "Resolved absolute model path: $modelPath")
        }

        // Try to infer mmproj path if not provided
        var mmprojPath = call.getString("mmprojPath")
        
        // Resolve absolute path for mmproj if provided
        if (mmprojPath != null) {
            var mmprojFile = File(mmprojPath)
            if (!mmprojFile.isAbsolute) {
                mmprojFile = File(bridge.context.filesDir, mmprojPath)
                mmprojPath = mmprojFile.absolutePath
                android.util.Log.i("VoxtralPlugin", "Resolved absolute mmproj path: $mmprojPath")
            }
        }

        if (mmprojPath == null) {
             val file = File(modelPath)
             val parent = file.parent
             val name = file.nameWithoutExtension
             val candidates = listOf(
                 File(parent, "${name}.mmproj"),
                 File(parent, "mmproj-model-f16.gguf"),
                 File(parent, "voxtral-mmproj.gguf")
             )
             mmprojPath = candidates.firstOrNull { it.exists() }?.absolutePath
        }

        if (mmprojPath == null) {
             return call.reject("mmprojPath required (could not infer from model path)")
        }

        val nThreads = call.getInt("nThreads", 4) ?: 4
        
        if (!File(modelPath).exists()) {
            return call.reject("Model file not found: $modelPath")
        }

        scope.launch {
            try {
                // Initialize inference engine
                inferenceEngine = VoxtralInferenceEngine()
                
                val success = inferenceEngine?.initModel(
                    modelPath = modelPath,
                    mmprojPath = mmprojPath!!,
                    nThreads = nThreads
                ) ?: false

                withContext(Dispatchers.Main) {
                    if (success) {
                        currentModelPath = modelPath  // Track loaded model path
                        call.resolve(JSObject().apply {
                            put("success", true)
                            put("modelPath", modelPath)
                            put("mmprojPath", mmprojPath)
                        })
                    } else {
                        call.reject("Failed to initialize model")
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Model init failed", e)
                withContext(Dispatchers.Main) {
                    call.reject("Init error: ${e.message}")
                }
            }
        }
    }

    /**
     * Start real-time streaming transcription
     * Microphone → Voxtral → Token stream events
     */
    @PluginMethod
    fun startRealtimeTranscription(call: PluginCall) {
        android.util.Log.i("VoxtralPlugin", "startRealtimeTranscription called")
        if (inferenceEngine == null || inferenceEngine?.isInitialized() != true) {
            return call.reject("Model not initialized. Call initModel first.")
        }

        if (isStreaming) {
            return call.reject("Already streaming")
        }

        // Reset context for clean transcription session
        inferenceEngine?.resetContext()
        val sessionStartTimeMs = System.currentTimeMillis()

        scope.launch {
            try {
                // Start audio capture
                audioProcessor = AudioStreamProcessor(
                    sampleRate = 16000,
                    channels = 1
                )

                audioProcessor?.startCapture { audioChunk ->
                    // Process audio chunk with Voxtral
                    val numTokens = inferenceEngine?.processAudioChunk(audioChunk)
                        ?: VoxtralInferenceEngine.VOXTRAL_ERR_NULL_HANDLE

                    when {
                        numTokens > 0 -> {
                            val tokens = inferenceEngine?.drainTokens() ?: emptyList()
                            if (tokens.isNotEmpty()) {
                                val now = System.currentTimeMillis()
                                val relativeTimeMs = now - sessionStartTimeMs
                                val results = tokens.map { text ->
                                    TokenResult(
                                        text = text,
                                        timestampMs = now,
                                        confidence = 1.0f,
                                        startMs = relativeTimeMs - 500, // Approximate for streaming token
                                        endMs = relativeTimeMs
                                    )
                                }
                                notifyTokens(results)
                            }
                        }
                        numTokens < 0 -> {
                            // Emit error event to frontend
                            notifyListeners("voxtralError", JSObject().apply {
                                put("code", numTokens)
                                put("message", VoxtralInferenceEngine.errorCodeToString(numTokens))
                            })
                        }
                        // numTokens == 0 or 1 (buffering) — no action needed
                    }
                }

                isStreaming = true

                withContext(Dispatchers.Main) {
                    call.resolve(JSObject().apply {
                        put("streaming", true)
                    })
                }

            } catch (e: Exception) {
                Log.e(TAG, "Streaming failed", e)
                withContext(Dispatchers.Main) {
                    call.reject("Streaming error: ${e.message}")
                }
            }
        }
    }

    /**
     * Stop real-time streaming
     */
    @PluginMethod
    fun stopRealtimeTranscription(call: PluginCall) {
        audioProcessor?.stopCapture()
        audioProcessor = null
        isStreaming = false

        call.resolve(JSObject().apply {
            put("streaming", false)
        })
    }

    /**
     * Batch transcription (post-processing)
     * Not yet supported in JNI bridge
     */
    @PluginMethod
    fun transcribeFile(call: PluginCall) {
        call.reject("Batch transcription not supported in this version")
    }

    /**
     * Unload model from memory
     */
    @PluginMethod
    fun unloadModel(call: PluginCall) {
        stopRealtimeTranscription(call)
        inferenceEngine?.release()
        inferenceEngine = null
        currentModelPath = null  // Clear tracked path

        call.resolve(JSObject().apply {
            put("unloaded", true)
        })
    }

    /**
     * Get model info
     */
    @PluginMethod
    fun getModelInfo(call: PluginCall) {
         val loaded = inferenceEngine?.isModelLoaded() ?: false
         call.resolve(JSObject().apply {
            put("loaded", loaded)
            put("modelPath", currentModelPath)
         })
    }

    /**
     * Reset the transcription context (KV cache, buffers)
     */
    @PluginMethod
    fun resetContext(call: PluginCall) {
        inferenceEngine?.resetContext()
        call.resolve(JSObject().apply {
            put("reset", true)
        })
    }

    /**
     * Send token stream to frontend
     */
    private fun notifyTokens(tokens: List<TokenResult>) {
        val data = JSObject().apply {
            put("tokens", JSArray().apply {
                tokens.forEach { token ->
                    put(JSObject().apply {
                        put("text", token.text)
                        put("timestampMs", token.timestampMs)
                        put("confidence", token.confidence)
                        put("start_ms", Math.max(0, token.startMs))
                        put("end_ms", token.endMs)
                    })
                }
            })
        }

        notifyListeners("voxtralTokens", data)
    }

    /**
     * Copy file from source to destination using streams to avoid OOM
     */
    @PluginMethod
    fun copyFile(call: PluginCall) {
        val sourcePath = call.getString("sourcePath")
        val fileName = call.getString("fileName")

        if (sourcePath == null || fileName == null) {
            call.reject("Missing sourcePath or fileName")
            return
        }

        try {
            val context = bridge.context
            val inputStream = if (sourcePath.startsWith("content://")) {
                context.contentResolver.openInputStream(android.net.Uri.parse(sourcePath))
            } else {
                java.io.FileInputStream(sourcePath)
            }
            
            if (inputStream == null) {
                call.reject("Failed to open input stream")
                return
            }

            val destFile = File(context.filesDir, fileName)
            Log.d(TAG, "Copying to: ${destFile.absolutePath}")
            
            // Ensure parent directory exists
            if (destFile.parentFile?.exists() == false) {
                val created = destFile.parentFile?.mkdirs()
                Log.d(TAG, "Created parent directory: ${destFile.parentFile?.absolutePath} -> $created")
            }

            val outputStream = java.io.FileOutputStream(destFile)
            var bytesCopied = 0L

            // Use use block to auto-close streams
            inputStream.use { input ->
                outputStream.use { output ->
                    bytesCopied = input.copyTo(output)
                }
            }
            
            Log.d(TAG, "File copied successfully. Bytes: $bytesCopied. Path: ${destFile.absolutePath}")
            
            // Verify file exists and size
            if (destFile.exists()) {
                 Log.d(TAG, "Verification: File exists. Size: ${destFile.length()}")
            } else {
                 Log.e(TAG, "Verification FAILED: File does not exist after copy!")
            }

            call.resolve(JSObject().apply {
                put("path", destFile.absolutePath)
            })

        } catch (e: Exception) {
            call.reject("Copy failed: ${e.message}")
        }
    }

    override fun handleOnDestroy() {
        super.handleOnDestroy()
        audioProcessor?.stopCapture()
        inferenceEngine?.release()
        scope.cancel()
    }
}

/**
 * Token result from streaming inference
 */
data class TokenResult(
    val text: String,
    val timestampMs: Long,
    val confidence: Float,
    val startMs: Long = 0,
    val endMs: Long = 0
)

/**
 * Segment result from batch transcription
 */
data class SegmentResult(
    val text: String,
    val startMs: Long,
    val endMs: Long,
    val confidence: Float
)

/**
 * Transcription result
 */
data class TranscriptionResult(
    val text: String,
    val segments: List<SegmentResult>
)

/**
 * Model info
 */
data class ModelInfo(
    val modelName: String,
    val parameters: Long,
    val transcriptionDelayMs: Int,
    val memoryUsageMB: Float
)
