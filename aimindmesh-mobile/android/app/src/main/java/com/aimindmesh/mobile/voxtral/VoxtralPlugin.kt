package com.aimindmesh.mobile.voxtral

import android.Manifest
import android.content.pm.PackageManager
import android.util.Log
import androidx.core.content.ContextCompat
import com.getcapacitor.*
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.File

@CapacitorPlugin(name = "Voxtral")
class VoxtralPlugin : Plugin() {

    private var inferenceEngine: VoxtralInferenceEngine? = null
    private var audioProcessor: AudioStreamProcessor? = null
    // Meeting recordings: the recorder's audio instead of a second microphone
    private var externalFeeder: ExternalAudioFeeder? = null
    @Volatile
    private var isStreaming = false
    private var currentModelPath: String? = null  // Track loaded model path
    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    // Orders init/start/stop/unload/reset: a model is never swapped or freed under the capture thread
    private val lifecycle = Mutex()

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
        val mmproj: String = mmprojPath
        val resolvedModelPath: String = modelPath

        val nThreads = call.getInt("nThreads", 4) ?: 4
        
        if (!File(modelPath).exists()) {
            return call.reject("Model file not found: $modelPath")
        }

        scope.launch {
            try {
                val success = lifecycle.withLock {
                    // A previous model (e.g. kept across a WebView reload) is freed before loading
                    // the next one: two multi-GB models do not fit in RAM
                    stopStreamingLocked()
                    inferenceEngine?.release()
                    inferenceEngine = null
                    currentModelPath = null

                    val engine = VoxtralInferenceEngine()
                    val ok = engine.initModel(modelPath = resolvedModelPath, mmprojPath = mmproj, nThreads = nThreads)
                    if (ok) {
                        inferenceEngine = engine
                        currentModelPath = resolvedModelPath
                    }
                    ok
                }

                if (success) {
                    call.resolve(JSObject().apply {
                        put("success", true)
                        put("modelPath", resolvedModelPath)
                        put("mmprojPath", mmproj)
                    })
                } else {
                    call.reject("Failed to initialize model")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Model init failed", e)
                call.reject("Init error: ${e.message}")
            }
        }
    }

    /**
     * Start real-time streaming transcription
     * Microphone → Voxtral → Token stream events.
     * With externalAudio: true, the meeting recorder's audio (MeetingRecorder) instead of the
     * microphone, and token times are positions in that recording.
     */
    @PluginMethod
    fun startRealtimeTranscription(call: PluginCall) {
        android.util.Log.i("VoxtralPlugin", "startRealtimeTranscription called")
        val externalAudio = call.getBoolean("externalAudio", false) == true
        if (!externalAudio && ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED) {
            return call.reject("Microphone permission (RECORD_AUDIO) not granted")
        }

        scope.launch {
            try {
                lifecycle.withLock {
                    val engine = inferenceEngine
                    if (engine == null || !engine.isInitialized()) {
                        call.reject("Model not initialized. Call initModel first.")
                        return@withLock
                    }
                    if (isStreaming) {
                        call.reject("Already streaming")
                        return@withLock
                    }

                    // Reset context for clean transcription session
                    engine.resetContext()
                    if (externalAudio) {
                        startExternalLocked(engine)
                        call.resolve(JSObject().apply { put("streaming", true) })
                        return@withLock
                    }
                    val sessionStartTimeMs = System.currentTimeMillis()
                    val processor = AudioStreamProcessor(sampleRate = 16000, channels = 1)

                    val started = processor.startCapture { audioChunk ->
                        handleAudioChunk(engine, audioChunk, sessionStartTimeMs)
                    }
                    if (!started) {
                        call.reject("Microphone unavailable: permission denied or in use by another app")
                        return@withLock
                    }

                    audioProcessor = processor
                    isStreaming = true
                    call.resolve(JSObject().apply {
                        put("streaming", true)
                    })
                }
            } catch (e: Exception) {
                Log.e(TAG, "Streaming failed", e)
                call.reject("Streaming error: ${e.message}")
            }
        }
    }

    /** Runs on the capture thread: transcribes one chunk and forwards tokens or errors */
    private fun handleAudioChunk(engine: VoxtralInferenceEngine, audioChunk: FloatArray, sessionStartTimeMs: Long) {
        val numTokens = engine.processAudioChunk(audioChunk)

        when {
            numTokens > 0 -> {
                val tokens = engine.drainTokens()
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

    /** Streams the recorder's audio: token times come from sample positions in the recording */
    private fun startExternalLocked(engine: VoxtralInferenceEngine) {
        var pendingStartMs = -1L // start of the text not emitted yet
        val feeder = ExternalAudioFeeder(onLagging = {
            notifyListeners("voxtralLagging", JSObject().apply {
                put("message", "Live transcription is behind the recording: some live text is skipped")
            })
        })
        feeder.start { audioChunk, startSample ->
            val chunkStartMs = startSample / 16
            val chunkEndMs = (startSample + audioChunk.size) / 16
            if (pendingStartMs < 0) pendingStartMs = chunkStartMs
            val numTokens = engine.processAudioChunk(audioChunk)
            if (numTokens > 0) {
                val tokens = engine.drainTokens()
                if (tokens.isNotEmpty()) {
                    val now = System.currentTimeMillis()
                    notifyTokens(tokens.map { TokenResult(it, now, 1.0f, pendingStartMs, chunkEndMs) })
                    pendingStartMs = chunkEndMs
                }
            } else if (numTokens < 0) {
                notifyListeners("voxtralError", JSObject().apply {
                    put("code", numTokens)
                    put("message", VoxtralInferenceEngine.errorCodeToString(numTokens))
                })
            }
        }
        externalFeeder = feeder
        isStreaming = true
    }

    /** Stops the audio source and waits for the chunk in flight; caller holds [lifecycle] */
    private fun stopStreamingLocked() {
        audioProcessor?.stopCapture()
        audioProcessor = null
        externalFeeder?.stop()
        externalFeeder = null
        isStreaming = false
    }

    /**
     * Stop real-time streaming
     */
    @PluginMethod
    fun stopRealtimeTranscription(call: PluginCall) {
        scope.launch {
            lifecycle.withLock { stopStreamingLocked() }
            call.resolve(JSObject().apply {
                put("streaming", false)
            })
        }
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
        scope.launch {
            lifecycle.withLock {
                stopStreamingLocked()
                inferenceEngine?.release()
                inferenceEngine = null
                currentModelPath = null  // Clear tracked path
            }
            call.resolve(JSObject().apply {
                put("unloaded", true)
            })
        }
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
        scope.launch {
            lifecycle.withLock { inferenceEngine?.resetContext() }
            call.resolve(JSObject().apply {
                put("reset", true)
            })
        }
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

        // Model files are GBs: copy off the shared Capacitor plugin thread
        scope.launch(Dispatchers.IO) { copyFileBlocking(call, sourcePath, fileName) }
    }

    private fun copyFileBlocking(call: PluginCall, sourcePath: String, fileName: String) {
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
        scope.cancel()
        val processor = audioProcessor
        val feeder = externalFeeder
        val engine = inferenceEngine
        audioProcessor = null
        externalFeeder = null
        inferenceEngine = null
        isStreaming = false
        // stopCapture waits for the chunk in flight: not on the main thread
        Thread({
            processor?.stopCapture()
            feeder?.stop(0)
            engine?.release()
        }, "Voxtral-Teardown").start()
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
