/*
 * LiteRT Capacitor Plugin
 * Implements LLM inference using Google AI Edge LiteRT (formerly LiteRT GenAI)
 * Supports .litertlm models
 */

package com.aimindmesh.mobile.litert

import android.graphics.Bitmap
import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Content
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.Conversation
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.ExperimentalApi
import com.google.ai.edge.litertlm.ExperimentalFlags
import com.google.ai.edge.litertlm.Message
import com.google.ai.edge.litertlm.SamplerConfig
import com.aimindmesh.mobile.litert.cache.ConversationPersistenceManager
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

private const val TAG = "LiteRTPlugin"

@OptIn(ExperimentalApi::class)
@CapacitorPlugin(name = "LiteRT")
class LiteRTPlugin : Plugin() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    // LiteRT Engine - Companion object for static persistence across Activity recreation
    companion object {
        // Static instance of the engine to survive Activity destruction
        @Volatile private var engine: Engine? = null
        @Volatile private var currentModelPath: String? = null
        private var currentBackend: String = "GPU"

        // Persistent conversation state
        @Volatile private var currentConversation: Conversation? = null
        // Throwaway conversations used by the multi-chunk audio path (cancellable by stopGeneration)
        @Volatile private var transientConversation: Conversation? = null
        private val conversationHistory = mutableListOf<Message>()
        private var persistenceManager: ConversationPersistenceManager? = null
        @Volatile private var storeChats: Boolean = false

        // Tool calling: definitions are sent once per conversation (it keeps them in context)
        @Volatile private var toolDefinitions: String? = null
        @Volatile private var toolCallingEnabled: Boolean = false
        @Volatile private var toolsSentInConversation: Boolean = false

        // Lock order: generationMutex, then mutex. A generation holds generationMutex until the
        // native call has returned, so close/reload paths wait for it instead of freeing a busy session.
        private val generationMutex = Mutex()
        private val mutex = Mutex()
        private const val STOP_WAIT_MS = 15_000L

        private fun samplerConfig() = SamplerConfig(topK = 40, topP = 0.95, temperature = 0.8)

        /** Memory-pressure hook (MemoryPressureManager): frees the engine only if nothing is running. */
        @JvmStatic
        fun trimIfIdle() {
            Thread(trim@{
                if (!generationMutex.tryLock()) return@trim
                try {
                    if (!mutex.tryLock()) return@trim
                    try {
                        try { currentConversation?.close() } catch (e: Exception) { Log.w(TAG, "trim: close conversation", e) }
                        currentConversation = null
                        toolsSentInConversation = false
                        conversationHistory.clear()
                        try { engine?.close() } catch (e: Exception) { Log.w(TAG, "trim: close engine", e) }
                        engine = null
                        currentModelPath = null
                        Log.w(TAG, "LiteRT engine released under memory pressure")
                    } finally {
                        mutex.unlock()
                    }
                } finally {
                    generationMutex.unlock()
                }
            }, "LiteRT-Trim").start()
        }
    }

    // Active streaming call tracking
    @Volatile private var activeStreamingCall: PluginCall? = null

    // Active generation job tracking (for generic cancellation)
    @Volatile private var activeGenerationJob: Job? = null

    // Fast reject of concurrent generations; generationMutex is what actually serializes them
    private val isGenerating = AtomicBoolean(false)
    private val generationId = AtomicLong(0)

    override fun load() {
        super.load()
        persistenceManager = ConversationPersistenceManager(context)
        Log.i(TAG, "LiteRTPlugin loaded with PersistenceManager")
    }

    /** Cancels the running generation and runs [block] once it has left the native code (null on timeout). */
    private suspend fun <T> withGenerationStopped(block: suspend () -> T): T? {
        try {
            currentConversation?.cancelProcess()
            transientConversation?.cancelProcess()
        } catch (e: Exception) {
            Log.w(TAG, "cancelProcess() failed (safe to ignore): ${e.message}")
        }
        activeGenerationJob?.cancel()
        return withTimeoutOrNull(STOP_WAIT_MS) {
            generationMutex.withLock { mutex.withLock { block() } }
        }
    }

    /** Caller holds [mutex]. */
    private fun closeConversationLocked() {
        try {
            currentConversation?.close()
        } catch (e: Exception) {
            Log.w(TAG, "Error closing conversation: ${e.message}")
        }
        currentConversation = null
        toolsSentInConversation = false
    }

    /** Caller holds [mutex]: returns the persistent conversation, creating it if needed. */
    private suspend fun ensureConversationLocked(currentEngine: Engine): Conversation {
        currentConversation?.let { return it }
        Log.i(TAG, "🆕 Creating persistent session...")
        val created = try {
            currentEngine.createConversation(ConversationConfig(samplerConfig = samplerConfig()))
        } catch (e: Exception) {
            if (e.message?.contains("session already exists") != true) throw e
            Log.w(TAG, "Session leak detected, force clearing and retrying...")
            System.gc()
            System.runFinalization()
            delay(250)
            currentEngine.createConversation(ConversationConfig(samplerConfig = samplerConfig()))
        }
        currentConversation = created
        toolsSentInConversation = false
        return created
    }

    private fun startGeneration(call: PluginCall): Long? {
        if (!isGenerating.compareAndSet(false, true)) {
            call.reject("Another generation is in progress")
            return null
        }
        return generationId.incrementAndGet()
    }

    private fun endGeneration(id: Long) {
        // A stop + new request may already own the flag
        if (generationId.get() == id) isGenerating.set(false)
    }

    @PluginMethod
    fun initModel(call: PluginCall) {
        val modelPath = call.getString("modelPath")
        val backendStr = call.getString("backend") ?: "GPU"
        val useVisionGpu = call.getBoolean("useVisionGpu") ?: false  // Dynamic vision backend
        val useNPU = call.getBoolean("useNPU") ?: false              // Qualcomm QNN/Hexagon NPU delegate
        val enableMtp = call.getBoolean("enableMtp") ?: true         // Multi-Token Prediction (Speculative Decoding)
        val shouldStoreChats = call.getBoolean("storeChats") ?: false

        if (modelPath == null) {
            call.reject("modelPath is required")
            return
        }

        val maxTokens = call.getInt("maxTokens") ?: 8192 // Default to 8k if not provided
        val enableAudio = call.getBoolean("enableAudio") ?: true

        scope.launch {
            try {
                val reused = withContext(Dispatchers.IO) {
                    val same = mutex.withLock {
                        // Reuse a loaded engine; only non-destructive flags change mid-chat
                        if (engine != null && currentModelPath == modelPath) {
                            Log.i(TAG, "🟢 LiteRT model already loaded: $modelPath. Reusing...")
                            storeChats = shouldStoreChats
                            currentBackend = backendStr
                            true
                        } else false
                    }
                    if (same) return@withContext true

                    // A different model: stop any generation before closing what it uses
                    withGenerationStopped {
                        // Conversation first: it belongs to the engine being closed
                        closeConversationLocked()
                        conversationHistory.clear()
                        if (engine != null) {
                            Log.i(TAG, "♻️ Unloading previous LiteRT model...")
                            try {
                                engine?.close()
                            } catch (e: Exception) {
                                Log.w(TAG, "Error closing engine: ${e.message}")
                            }
                            engine = null
                            currentModelPath = null
                            System.gc() // Suggest cleanup
                        }

                        val useGpu = backendStr.equals("GPU", ignoreCase = true)
                        currentBackend = backendStr
                        storeChats = shouldStoreChats

                        val backend = if (useGpu) Backend.GPU() else Backend.CPU()
                        // Vision backend stays CPU unless GPU vision is requested (matches gallery-main)
                        val visionBackend: Backend? = if (useVisionGpu) Backend.GPU() else Backend.CPU()
                        val audioBackend: Backend? = if (enableAudio) Backend.CPU() else null

                        val finalBackend = if (useNPU) {
                            Log.i(TAG, "🧠 NPU delegate requested - Using Backend.NPU")
                            try {
                                Backend.NPU(nativeLibraryDir = context.applicationInfo.nativeLibraryDir)
                            } catch (e: Exception) {
                                Log.w(TAG, "NPU backend init failed, falling back to $backendStr: ${e.message}")
                                backend
                            }
                        } else {
                            backend
                        }

                        // Quiet native logs
                        try {
                            android.system.Os.setenv("TF_CPP_MIN_LOG_LEVEL", "3", true)
                            android.system.Os.setenv("GLOG_minloglevel", "3", true)
                        } catch (e: Exception) {
                            Log.w(TAG, "Failed to set native log levels", e)
                        }

                        // Default cacheDir (null) works for models in app storage
                        val config = EngineConfig(
                            modelPath = modelPath,
                            backend = finalBackend,
                            visionBackend = visionBackend,
                            audioBackend = audioBackend,
                            maxNumTokens = maxTokens
                        )

                        // Speculative decoding only during engine creation: leaving it on corrupts createConversation()
                        ExperimentalFlags.enableSpeculativeDecoding = if (useGpu) enableMtp else false
                        Log.i(TAG, "🎯 Backend: $backendStr, Vision: ${if (useVisionGpu) "GPU" else "CPU"}, Audio: $enableAudio, NPU: $useNPU, MTP: ${ExperimentalFlags.enableSpeculativeDecoding}, Store Chats: $shouldStoreChats")
                        try {
                            val newEngine = Engine(config)
                            newEngine.initialize()
                            engine = newEngine
                            currentModelPath = modelPath
                        } finally {
                            ExperimentalFlags.enableSpeculativeDecoding = false
                        }
                    } ?: throw IllegalStateException("A generation is still running; model not switched")
                    false
                }

                call.resolve(JSObject().apply {
                    put("success", true)
                    put("backend", currentBackend)
                    put("reused", reused)
                })
            } catch (e: Exception) {
                Log.e(TAG, "Failed to load model: ${e.message}", e)
                call.resolve(JSObject().apply {
                    put("success", false)
                    put("error", e.message ?: "Unknown error")
                })
            }
        }
    }

    @PluginMethod
    fun generateResponse(call: PluginCall) {
        if (engine == null) {
            call.reject("Model not loaded. Call initModel first.")
            return
        }
        val prompt = call.getString("prompt")
        if (prompt == null) {
            call.reject("prompt is required")
            return
        }
        val id = startGeneration(call) ?: return

        val bitmaps = LiteRTInputs.decodeImages(call.getArray("images"), context)
        val audioPaths = LiteRTInputs.stringList(call.getArray("audio"))

        activeGenerationJob = scope.launch {
            try {
                val responseText = withContext(Dispatchers.IO) {
                    generationMutex.withLock {
                        val currentEngine = engine ?: throw IllegalStateException("Model not loaded. Call initModel first.")
                        val audioBytes = audioPaths.mapNotNull { path ->
                            LiteRTAudio.decodeAudioToPcm(path, context).also {
                                if (it == null) Log.e(TAG, "Failed to decode audio: $path")
                            }
                        }
                        val conversation = mutex.withLock { ensureConversationLocked(currentEngine) }
                        val message = Message.user(Contents.of(LiteRTInputs.buildContents(bitmaps, audioBytes, prompt)))
                        val response = conversation.sendMessage(message)
                        if (storeChats) {
                            mutex.withLock {
                                conversationHistory.add(message)
                                conversationHistory.add(response)
                            }
                        }
                        response.contents.contents
                            .filterIsInstance<Content.Text>()
                            .joinToString("") { it.text }
                    }
                }
                endGeneration(id) // release BEFORE notifying TS
                call.resolve(JSObject().apply {
                    put("text", responseText)
                    put("done", true)
                })
            } catch (e: Exception) {
                endGeneration(id)
                Log.e(TAG, "Generation failed: ${e.message}", e)
                call.reject("Generation failed: ${e.message}")
            } finally {
                endGeneration(id)
            }
        }
    }

    @PluginMethod(returnType = PluginMethod.RETURN_CALLBACK)
    fun generateResponseStream(call: PluginCall) {
        if (engine == null) {
            call.reject("Model not loaded. Call initModel first.")
            return
        }
        val prompt = call.getString("prompt")
        if (prompt == null) {
            call.reject("prompt is required")
            return
        }
        val id = startGeneration(call) ?: return

        val bitmaps = LiteRTInputs.decodeImages(call.getArray("images"), context)
        val audioPaths = LiteRTInputs.stringList(call.getArray("audio"))

        call.setKeepAlive(true)
        activeStreamingCall = call

        // Results always go to this call: a stream finishing late never resolves a newer request
        activeGenerationJob = scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    generationMutex.withLock {
                        val currentEngine = engine ?: throw IllegalStateException("Model not loaded. Call initModel first.")
                        // Pre-decode all audio to get chunks
                        val allAudioChunks = audioPaths.flatMap { LiteRTAudio.decodeAndChunkAudio(it, context) }
                        if (allAudioChunks.size > 1) {
                            processAudioChunksSequentially(currentEngine, allAudioChunks, call, prompt)
                        } else {
                            streamSingleMessage(currentEngine, call, prompt, bitmaps, allAudioChunks.firstOrNull())
                        }
                    }
                }
                endGeneration(id)
                finishStream(call, null)
            } catch (e: CancellationException) {
                // stopGeneration(): close the JS callback without an error
                endGeneration(id)
                finishStream(call, null)
            } catch (e: Exception) {
                endGeneration(id)
                Log.e(TAG, "Streaming failed: ${e.message}", e)
                finishStream(call, e.message ?: "Unknown error")
            } finally {
                endGeneration(id)
            }
        }
    }

    private suspend fun streamSingleMessage(
        currentEngine: Engine,
        call: PluginCall,
        prompt: String,
        bitmaps: List<Bitmap>,
        audioChunk: ByteArray?
    ) {
        val (conversation, tools) = mutex.withLock {
            val conv = ensureConversationLocked(currentEngine)
            val defs = if (toolCallingEnabled && !toolsSentInConversation) toolDefinitions else null
            if (defs != null) toolsSentInConversation = true
            conv to defs
        }
        val finalPrompt = if (tools != null) LiteRTInputs.withTools(prompt, tools) else prompt
        val message = Message.user(Contents.of(LiteRTInputs.buildContents(bitmaps, listOfNotNull(audioChunk), finalPrompt)))

        val fullResponse = StringBuilder()
        conversation.sendMessageAsync(message).collect { partialMessage ->
            val text = partialMessage.contents.contents
                .filterIsInstance<Content.Text>()
                .joinToString("") { it.text }
            val thoughtText = partialMessage.channels["thought"]
            fullResponse.append(text)
            call.resolve(JSObject().apply {
                put("text", text)
                put("done", false)
                if (!thoughtText.isNullOrEmpty()) {
                    put("thinkingText", thoughtText)
                }
            })
        }

        if (storeChats) {
            mutex.withLock {
                conversationHistory.add(message)
                // Saved with the model role so a restored history keeps who said what
                conversationHistory.add(Message.model(fullResponse.toString()))
            }
        }
    }

    private fun finishStream(call: PluginCall, error: String?) {
        if (call.isReleased) return
        if (error != null) {
            call.reject("Streaming failed: $error")
        } else {
            call.resolve(JSObject().apply {
                put("text", "")
                put("done", true)
            })
        }
        call.release(bridge)
        if (activeStreamingCall === call) activeStreamingCall = null
    }

    @PluginMethod
    fun stopGeneration(call: PluginCall) {
        // Signal the native runtime first: cancelling only the coroutine leaves LiteRT generating.
        // cancelProcess() is non-blocking and safe to call from any thread.
        try {
            currentConversation?.cancelProcess()
            transientConversation?.cancelProcess()
        } catch (e: Exception) {
            Log.w(TAG, "cancelProcess() failed (safe to ignore): ${e.message}")
        }
        // The job's own catch closes the JS stream callback
        activeGenerationJob?.cancel()
        // Lets the next request in right away; generationMutex keeps it behind the native tail
        isGenerating.set(false)
        call.resolve(JSObject().apply { put("success", true) })
    }

    @PluginMethod
    fun releaseModel(call: PluginCall) {
        scope.launch {
            val released = withContext(Dispatchers.IO) {
                withGenerationStopped {
                    closeConversationLocked()
                    conversationHistory.clear()
                    try {
                        engine?.close()
                    } catch (e: Exception) {
                        Log.w(TAG, "Error closing engine during releaseModel: ${e.message}")
                    }
                    engine = null
                    currentModelPath = null
                    true
                }
            }
            if (released == true) {
                call.resolve(JSObject().apply { put("success", true) })
            } else {
                call.reject("A generation is still running; model not released")
            }
        }
    }

    @PluginMethod
    fun isModelLoaded(call: PluginCall) {
        scope.launch {
            val result = withContext(Dispatchers.IO) {
                mutex.withLock {
                    JSObject().apply {
                        put("isLoaded", engine != null)
                        put("modelPath", currentModelPath)
                    }
                }
            }
            call.resolve(result)
        }
    }

    @PluginMethod
    fun registerTools(call: PluginCall) {
        val toolsArray = call.getArray("tools")
        if (toolsArray == null) {
            call.reject("tools array is required")
            return
        }

        // An empty list turns native tool prompting off (tool calling disabled in the app)
        val formatted = LiteRTInputs.formatTools(toolsArray)
        val enabled = formatted.isNotEmpty()
        if (formatted != toolDefinitions) {
            toolsSentInConversation = false
        }
        toolDefinitions = if (enabled) formatted else null
        toolCallingEnabled = enabled
        Log.i(TAG, if (enabled) "Registered ${toolsArray.length()} tools for native function calling" else "Native tool prompting disabled")

        call.resolve(JSObject().apply { put("success", true) })
    }

    @PluginMethod
    fun getAvailableBackends(call: PluginCall) {
        val backends = JSObject().apply {
            put("backends", listOf("CPU", "GPU"))
        }
        call.resolve(backends)
    }

    @PluginMethod
    fun releaseSession(call: PluginCall) {
        scope.launch {
            val released = withContext(Dispatchers.IO) {
                withGenerationStopped {
                    closeConversationLocked()
                    conversationHistory.clear()
                    System.gc()
                    Log.i(TAG, "Session released and closed")
                    true
                }
            }
            if (released == true) {
                call.resolve(JSObject().apply { put("success", true) })
            } else {
                call.reject("A generation is still running; session not released")
            }
        }
    }

    @PluginMethod
    fun getMessageCount(call: PluginCall) {
        scope.launch {
            val count = mutex.withLock { conversationHistory.size }
            val ret = JSObject().apply {
                put("count", count)
            }
            call.resolve(ret)
        }
    }

    @PluginMethod
    fun saveKvCache(call: PluginCall) {
        val conversationId = call.getString("conversationId") ?: "default"
        scope.launch {
            val success = withContext(Dispatchers.IO) {
                mutex.withLock {
                    persistenceManager?.saveConversation(conversationId, conversationHistory) ?: false
                }
            }
            if (success) {
                call.resolve(JSObject().apply { put("success", true) })
            } else {
                call.reject("Failed to save KV Cache history")
            }
        }
    }

    @PluginMethod
    fun restoreKvCache(call: PluginCall) {
        val conversationId = call.getString("conversationId") ?: "default"
        if (engine == null) {
            call.reject("Model not loaded. Call initModel first.")
            return
        }

        scope.launch {
            try {
                val restoredMessages = withContext(Dispatchers.IO) {
                    persistenceManager?.loadConversation(conversationId)
                }

                if (restoredMessages == null) {
                    call.reject("No saved cache found for $conversationId")
                    return@launch
                }

                val restored = withContext(Dispatchers.IO) {
                    withGenerationStopped {
                        val currentEngine = engine ?: throw IllegalStateException("Model not loaded. Call initModel first.")
                        closeConversationLocked()
                        // History goes in as initialMessages: prefilled on the next turn,
                        // instead of one full generation per restored message
                        Log.i(TAG, "Restoring ${restoredMessages.size} messages into a new conversation...")
                        currentConversation = currentEngine.createConversation(
                            ConversationConfig(initialMessages = restoredMessages, samplerConfig = samplerConfig())
                        )
                        conversationHistory.clear()
                        conversationHistory.addAll(restoredMessages)
                        true
                    }
                } ?: throw IllegalStateException("A generation is still running")

                call.resolve(JSObject().apply {
                    put("success", restored)
                    put("messageCount", restoredMessages.size)
                })
            } catch (e: Exception) {
                Log.e(TAG, "Failed to restore KV Cache", e)
                call.reject("Failed to restore KV Cache: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun invalidateKvCache(call: PluginCall) {
        val conversationId = call.getString("conversationId") ?: "default"
        persistenceManager?.invalidateCache(conversationId)
        call.resolve(JSObject().apply { put("success", true) })
    }

    /**
     * Process multiple audio chunks sequentially, each in its own conversation
     * This bypasses the LiteRT 1-clip limitation by making multiple calls.
     * Caller holds generationMutex.
     */
    private suspend fun processAudioChunksSequentially(
        engine: Engine,
        chunks: List<ByteArray>,
        call: PluginCall,
        originalPrompt: String
    ) {
        // LiteRT-LM allows one live session per engine: the persistent one is closed (and its
        // history cleared, so the JS side resyncs) before the per-chunk conversations are created
        mutex.withLock {
            closeConversationLocked()
            conversationHistory.clear()
        }

        val totalChunks = chunks.size
        val chunkResponses = mutableListOf<String>()

        call.resolve(progressChunk("📊 Processing ${totalChunks} audio segments (${totalChunks * 30}s total)...\n\n"))

        for ((index, chunk) in chunks.withIndex()) {
            val chunkNum = index + 1
            call.resolve(progressChunk("🎵 Segment $chunkNum/$totalChunks: "))

            try {
                val contents = listOf(
                    Content.AudioBytes(chunk),
                    Content.Text("Transcribe and summarize this audio segment briefly:")
                )
                val responseText = runTransientConversation(engine, Message.user(Contents.of(contents)), call)
                chunkResponses.add(responseText.trim())
                call.resolve(progressChunk("\n\n"))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.e(TAG, "Error processing chunk $chunkNum: ${e.message}")
                call.resolve(progressChunk("[Error in segment $chunkNum]\n\n"))
            }
        }

        // If user wanted a summary, combine all chunk responses
        if (originalPrompt.lowercase().contains("summar") ||
            originalPrompt.lowercase().contains("sommario") ||
            chunkResponses.size > 3) {

            call.resolve(progressChunk("\n---\n📝 **Overall Summary:**\n"))
            try {
                val combinedText = chunkResponses.mapIndexed { i, r -> "Segment ${i + 1}: $r" }.joinToString("\n\n")
                val summaryMessage = Message.user(Contents.of(listOf(Content.Text(
                    "Here are transcriptions from ${chunkResponses.size} audio segments. Create a brief overall summary:\n\n$combinedText"
                ))))
                runTransientConversation(engine, summaryMessage, call)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.e(TAG, "Error creating summary: ${e.message}")
            }
        }
    }

    /** One-shot conversation whose partial output is streamed to [call]; always closed afterwards. */
    private suspend fun runTransientConversation(engine: Engine, message: Message, call: PluginCall): String {
        val conversation = engine.createConversation(ConversationConfig(samplerConfig = samplerConfig()))
        transientConversation = conversation
        val response = StringBuilder()
        try {
            conversation.sendMessageAsync(message).collect { partialMessage ->
                val text = partialMessage.contents.contents
                    .filterIsInstance<Content.Text>()
                    .joinToString("") { it.text }
                response.append(text)
                call.resolve(progressChunk(text))
            }
        } finally {
            transientConversation = null
            try {
                conversation.close()
            } catch (ce: Exception) {
                Log.e(TAG, "Error closing chunk conversation: ${ce.message}")
            }
        }
        return response.toString()
    }

    private fun progressChunk(text: String) = JSObject().apply {
        put("text", text)
        put("done", false)
    }
}
