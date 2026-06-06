/*
 * LiteRT Capacitor Plugin
 * Implements LLM inference using Google AI Edge LiteRT (formerly LiteRT GenAI)
 * Supports .litertlm models
 */

package com.aimindmesh.mobile.litert

import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.ExperimentalApi
import com.google.ai.edge.litertlm.ExperimentalFlags
import com.google.ai.edge.litertlm.Conversation
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Message
import com.google.ai.edge.litertlm.SamplerConfig
import com.google.ai.edge.litertlm.Content
import com.google.ai.edge.litertlm.Contents
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.onCompletion
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.collections.filterIsInstance
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.content.Context
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import java.nio.ByteBuffer
import com.aimindmesh.mobile.litert.cache.ConversationPersistenceManager


private const val TAG = "LiteRTPlugin"

@CapacitorPlugin(name = "LiteRT")
class LiteRTPlugin : Plugin() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    
    // LiteRT Engine - Companion object for static persistence across Activity recreation
    companion object {
        // Static instance of the engine to survive Activity destruction
        private var engine: Engine? = null
        private var currentModelPath: String? = null
        private var currentBackend: String = "GPU"
        private var currentVisionGpu: Boolean = false  // Track vision GPU state
        private var currentUseNPU: Boolean = false      // Track NPU delegate state
        
        // Persistent conversation state
        private var currentConversation: Conversation? = null
        private val conversationHistory = mutableListOf<Message>()
        private var persistenceManager: ConversationPersistenceManager? = null
        private var storeChats: Boolean = false
        private var messageCount: Int = 0
        
        // Mutex for non-blocking coroutine synchronization
        private val mutex = Mutex()
    }
    
    // Active streaming call tracking
    private var activeStreamingCall: PluginCall? = null
    
    // Active generation job tracking (for generic cancellation)
    private var activeGenerationJob: kotlinx.coroutines.Job? = null
    
    // Atomic guard to prevent concurrent inference sessions
    private val isGenerating = java.util.concurrent.atomic.AtomicBoolean(false)

    override fun load() {
        super.load()
        persistenceManager = ConversationPersistenceManager(context)
        Log.i(TAG, "LiteRTPlugin loaded with PersistenceManager")
    }

    @OptIn(ExperimentalApi::class)
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

        // Add guard: do not reload if a generation is currently active
        // A modelPath check could be added, but active generation is the main conflict risk.
        if (isGenerating.get() && engine != null) {
            Log.w(TAG, "Model reload requested while generating — ignored")
            call.resolve(JSObject().apply {
                put("success", true)
                put("reused", true)
            })
            return
        }

        val maxTokens = call.getInt("maxTokens") ?: 8192 // Default to 8k if not provided
        val enableAudio = call.getBoolean("enableAudio") ?: true
        
        // Cancel any active generation before re-initializing
        runBlocking {
            activeGenerationJob?.cancel()
            activeGenerationJob?.join()
        }
        
        scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    mutex.withLock {
                        // Check if we can reuse the existing engine - loosened condition
                        if (engine != null && currentModelPath == modelPath) {
                            Log.i(TAG, "🟢 LiteRT model already loaded: $modelPath. Reusing...")
                            
                            // Only update non-destructive flags. Engine backend changes won't apply structurally,
                            // but this guarantees we don't trigger massive RAM unloads mid-chat.
                            storeChats = shouldStoreChats
                            currentBackend = backendStr
                            
                             // Return success immediately
                             return@withContext
                        }
                        
                        // Close existing if open
                        if (engine != null) {
                             Log.i(TAG, "♻️ Unloading previous LiteRT model...")
                             try {
                                 engine?.close()
                             } catch (e: Exception) {
                                 Log.w(TAG, "Error closing engine: ${e.message}")
                             }
                             engine = null
                             System.gc() // Suggest cleanup
                        }

                        val requestedGpu = backendStr.equals("GPU", ignoreCase = true)
                        val useGpu = requestedGpu
                        currentBackend = backendStr
                        
                        currentModelPath = modelPath
                        currentVisionGpu = useVisionGpu
                        currentUseNPU = useNPU
                        storeChats = shouldStoreChats
                        
                        if (currentConversation != null) {
                            Log.i(TAG, "⚠️ Clearing existing session during model init...")
                            try {
                                currentConversation?.close()
                            } catch (e: Exception) {
                                Log.w(TAG, "Error closing conversation: ${e.message}")
                            }
                            currentConversation = null
                            System.gc()
                            System.runFinalization()
                            kotlinx.coroutines.delay(200)
                        }
                        messageCount = 0
                        
                        val backend = if (useGpu) Backend.GPU() else Backend.CPU()
                        // Bug #3: Pass null for vision/audio backends when not needed.
                        // Always passing non-null backends causes crashes on non-multimodal models
                        // and wastes RAM. Matches gallery-main reference implementation.
                        val visionBackend: Backend? = if (useVisionGpu) Backend.GPU() else if (enableAudio || true) Backend.CPU() else null
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

                        // Configure Engine
                        // Bug #5: Do not force cacheDir — the default (null) works for models in app storage.
                        // Passing context.cacheDir can conflict with model paths in standard download dirs.
                        val config = EngineConfig(
                            modelPath = modelPath,
                            backend = finalBackend,
                            visionBackend = visionBackend,
                            audioBackend = audioBackend,
                            maxNumTokens = maxTokens
                        )
                        
                        // Bug #1: Set ExperimentalFlags BEFORE engine creation, then RESET to false
                        // immediately after initialize(). Leaving it true during createConversation()
                        // corrupts the session — matches gallery-main reference implementation.
                        ExperimentalFlags.enableSpeculativeDecoding = if (useGpu) enableMtp else false
                        
                        Log.i(TAG, "🎯 Backend: $backendStr, Vision: ${if (useVisionGpu) "GPU" else "CPU"}, Audio: $enableAudio, NPU: $useNPU, MTP: ${ExperimentalFlags.enableSpeculativeDecoding}, Store Chats: $shouldStoreChats")
                        
                        val newEngine = Engine(config)
                        newEngine.initialize()
                        // Bug #1 Fix: Reset flag immediately after init so it doesn't corrupt createConversation()
                        ExperimentalFlags.enableSpeculativeDecoding = false
                        engine = newEngine
                    }
                }

                val result = JSObject().apply {
                    put("success", true)
                    put("backend", currentBackend)
                    put("reused", false) // Could track this if needed, but context return covers it
                }
                call.resolve(result)
                // Log.i(TAG, "LiteRT Model loaded successfully")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to load model: ${e.message}", e)
                val result = JSObject().apply {
                    put("success", false)
                    put("error", e.message ?: "Unknown error")
                }
                call.resolve(result)
            }
        }
    }

    @PluginMethod
    fun generateResponse(call: PluginCall) {
        val currentEngine = engine
        if (currentEngine == null) {
            call.reject("Model not loaded. Call initModel first.")
            return
        }

        val prompt = call.getString("prompt")
        if (prompt == null) {
            call.reject("prompt is required")
            return
        }

        // Process images
        val imagesArray = call.getArray("images")
        val bitmaps = mutableListOf<android.graphics.Bitmap>()
        
        if (imagesArray != null) {
            // Log.d(TAG, "generateResponse: Received ${imagesArray.length()} image entries")
            for (i in 0 until imagesArray.length()) {
                val imageData = imagesArray.getString(i)
                try {
                    val bitmap = when {
                        // Base64 encoded data
                        imageData.startsWith("data:image") -> {
                            val base64Data = imageData.substringAfter(",")
                            val bytes = android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT)
                            android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                        }
                        imageData.startsWith("/9j/") || imageData.startsWith("iVBOR") || imageData.length > 1000 -> {
                            // Pure base64 string (JPEG starts with /9j/, PNG with iVBOR)
                            val bytes = android.util.Base64.decode(imageData, android.util.Base64.DEFAULT)
                            android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                        }
                        imageData.startsWith("content://") -> {
                            val uri = android.net.Uri.parse(imageData)
                            val inputStream = context.contentResolver.openInputStream(uri)
                            android.graphics.BitmapFactory.decodeStream(inputStream)
                        }
                        else -> {
                            val cleanPath = if (imageData.startsWith("file://")) imageData.substring(7) else imageData
                            android.graphics.BitmapFactory.decodeFile(cleanPath)
                        }
                    }
                    
                    if (bitmap != null) {
                        bitmaps.add(bitmap)
                    } else {
                        Log.e(TAG, "Failed to decode bitmap: $imageData")
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error loading image $imageData: ${e.message}")
                }
            }
        }
        
        // Process audio
        val audioArray = call.getArray("audio")
        val audioBytesList = mutableListOf<ByteArray>()
        
        if (audioArray != null) {
            for (i in 0 until audioArray.length()) {
                val audioPath = audioArray.getString(i)
                // Decode audio to PCM
                val bytes = decodeAudioToPcm(audioPath, context)
                
                 if (bytes != null) {
                    // Log.d(TAG, "Decoded audio $audioPath to ${bytes.size} bytes PCM")
                    audioBytesList.add(bytes)
                } else {
                     Log.e(TAG, "Failed to decode audio: $audioPath")
                }
            }
        }

        activeGenerationJob = scope.launch {
            try {
                val responseText = withContext<String>(Dispatchers.IO) {
                    val conversation = mutex.withLock {
                        if (currentConversation == null) {
                            Log.i(TAG, "🆕 Creating persistent session...")
                            currentConversation = currentEngine.createConversation(
                                ConversationConfig(
                                    samplerConfig = SamplerConfig(
                                        topK = 40,
                                        topP = 0.95,
                                        temperature = 0.8
                                    )
                                )
                            )
                            messageCount = 0
                        }
                        currentConversation!!
                    }
                    
                    // Construct Message with optional images and audio
                    val contents = mutableListOf<com.google.ai.edge.litertlm.Content>()
                    
                    // Add images first
                    bitmaps.forEach { bitmap ->
                        val stream = java.io.ByteArrayOutputStream()
                        bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, stream)
                        val byteArray = stream.toByteArray()
                        contents.add(com.google.ai.edge.litertlm.Content.ImageBytes(byteArray))
                    }
                    
                    // Add audio second
                    audioBytesList.forEach { bytes ->
                         contents.add(com.google.ai.edge.litertlm.Content.AudioBytes(bytes))
                    }
                    
                    // Add text last
                    if (prompt.trim().isNotEmpty()) {
                        contents.add(com.google.ai.edge.litertlm.Content.Text(prompt))
                    }

                    val message = com.google.ai.edge.litertlm.Message.of(contents)
                    
                    val response = conversation.sendMessage(message)
                    
                    if (storeChats) {
                        mutex.withLock {
                            conversationHistory.add(message)
                            conversationHistory.add(response)
                            messageCount = conversationHistory.size
                        }
                    }

                    val text = response.contents.contents
                        .filterIsInstance<com.google.ai.edge.litertlm.Content.Text>()
                        .joinToString("") { it.text }
                    text
                }

                val result = JSObject().apply {
                    put("text", responseText)
                    put("done", true)
                }
                isGenerating.set(false) // Safe release BEFORE notifying TS callback
                call.resolve(result)
            } catch (e: Exception) {
                isGenerating.set(false) // Safe release BEFORE notifying TS callback
                Log.e(TAG, "Generation failed: ${e.message}", e)
                call.reject("Generation failed: ${e.message}")
            } finally {
                isGenerating.set(false)
            }
        }
    }

    @PluginMethod(returnType = PluginMethod.RETURN_CALLBACK)
    fun generateResponseStream(call: PluginCall) {
        val currentEngine = engine
        if (currentEngine == null) {
            call.reject("Model not loaded. Call initModel first.")
            return
        }

        if (!isGenerating.compareAndSet(false, true)) {
            call.reject("Another generation is in progress")
            return
        }

        val prompt = call.getString("prompt")
        if (prompt == null) {
            isGenerating.set(false)
            call.reject("prompt is required")
            return
        }

        // Process images
        val imagesArray = call.getArray("images")
        val bitmaps = mutableListOf<android.graphics.Bitmap>()
        
        if (imagesArray != null) {
            // Log.d(TAG, "Received ${imagesArray.length()} image entries")
            for (i in 0 until imagesArray.length()) {
                val imageData = imagesArray.getString(i)
                Log.d(TAG, "Processing image $i: ${imageData?.take(50)}...")
                try {
                    val bitmap = when {
                        // Base64 encoded data
                        imageData.startsWith("data:image") -> {
                            // Data URI: data:image/png;base64,xxxxx
                            val base64Data = imageData.substringAfter(",")
                            val bytes = android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT)
                            // Log.d(TAG, "Decoded base64 data URI: ${bytes.size} bytes")
                            android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                        }
                        imageData.startsWith("/9j/") || imageData.startsWith("iVBOR") || imageData.length > 1000 -> {
                            // Pure base64 string (JPEG starts with /9j/, PNG with iVBOR)
                            val bytes = android.util.Base64.decode(imageData, android.util.Base64.DEFAULT)
                            // Log.d(TAG, "Decoded pure base64: ${bytes.size} bytes")
                            android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                        }
                        imageData.startsWith("content://") -> {
                            val uri = android.net.Uri.parse(imageData)
                            val inputStream = context.contentResolver.openInputStream(uri)
                            android.graphics.BitmapFactory.decodeStream(inputStream)
                        }
                        else -> {
                            // File path
                            val cleanPath = if (imageData.startsWith("file://")) imageData.substring(7) else imageData
                            android.graphics.BitmapFactory.decodeFile(cleanPath)
                        }
                    }
                    
                    if (bitmap != null) {
                        bitmaps.add(bitmap)
                        // Log.d(TAG, "Successfully decoded image $i: ${bitmap.width}x${bitmap.height}")
                    } else {
                        Log.e(TAG, "Failed to decode bitmap $i: null result")
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error loading image $i: ${e.message}", e)
                }
            }
        }

        // Process audio paths (parse outside coroutine for thread safety)
        val audioArray = call.getArray("audio")
        val audioPaths = mutableListOf<String>()
        if (audioArray != null) {
            for (i in 0 until audioArray.length()) {
                audioPaths.add(audioArray.getString(i))
            }
        }
        // Log.d(TAG, "Audio paths received: ${audioPaths.size}")

        if (activeStreamingCall != null) {
            isGenerating.set(false)
            call.reject("Another streaming generation is in progress")
            return
        }

        call.setKeepAlive(true)
        activeStreamingCall = call

        activeGenerationJob = scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    // Pre-decode all audio to get chunks
                    val allAudioChunks = mutableListOf<ByteArray>()
                    audioPaths.forEach { audioPath ->
                        val chunks = decodeAndChunkAudio(audioPath, context)
                        allAudioChunks.addAll(chunks)
                    }
                    
                    // If multiple chunks exist, process sequentially
                    if (allAudioChunks.size > 1) {
                        // Log.d(TAG, "Multi-chunk audio: ${allAudioChunks.size} chunks, processing sequentially")
                        processAudioChunksSequentially(currentEngine, allAudioChunks, bitmaps, prompt)
                    } else {
                        // Single chunk or no audio - normal processing
                        // Log.d(TAG, "Creating conversation...")
                        
                        val conversation = mutex.withLock {
                            // PERSISTENT CONVERSATION: If it was null, create it. Otherwise, reuse it.
                            if (currentConversation == null) {
                                Log.i(TAG, "🆕 Creating persistent session...")
                                try {
                                    currentConversation = currentEngine.createConversation(
                                        ConversationConfig(
                                            samplerConfig = SamplerConfig(
                                                topK = 40,
                                                topP = 0.95,
                                                temperature = 0.8
                                            )
                                        )
                                    )
                                } catch (e: Exception) {
                                    if (e.message?.contains("session already exists") == true) {
                                        Log.w(TAG, "Session leak detected, force clearing and retrying...")
                                        currentConversation = null
                                        System.gc()
                                        System.runFinalization()
                                        kotlinx.coroutines.delay(250)
                                        currentConversation = currentEngine.createConversation(
                                            ConversationConfig(
                                                samplerConfig = SamplerConfig(
                                                    topK = 40,
                                                    topP = 0.95,
                                                    temperature = 0.8
                                                )
                                            )
                                        )
                                    } else {
                                        throw e
                                    }
                                }
                                messageCount = 0
                            }
                            currentConversation!!
                        }
                        
                        // Construct Message with optional images and audio
                        val contents = mutableListOf<com.google.ai.edge.litertlm.Content>()
                        
                        // Add images first
                        bitmaps.forEach { bitmap ->
                            val stream = java.io.ByteArrayOutputStream()
                            bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, stream)
                            val byteArray = stream.toByteArray()
                            contents.add(com.google.ai.edge.litertlm.Content.ImageBytes(byteArray))
                        }
                        
                        // Add single audio chunk if present
                        if (allAudioChunks.isNotEmpty()) {
                            val chunk = allAudioChunks.first()
                            // Log.d(TAG, "Adding audio to contents: ${chunk.size} bytes")
                            contents.add(com.google.ai.edge.litertlm.Content.AudioBytes(chunk))
                        }
                        
                        // Add text last
                        if (prompt.trim().isNotEmpty()) {
                            contents.add(com.google.ai.edge.litertlm.Content.Text(prompt))
                        }

                        val message = com.google.ai.edge.litertlm.Message.of(contents)
                        
                        // Log.d(TAG, "Sending message async: ${prompt.take(100)}... with ${bitmaps.size} images, ${allAudioChunks.size} audio chunks, total contents: ${contents.size}")

                        // Enable keep-alive for streaming
                        activeStreamingCall?.setKeepAlive(true)

                        var totalLength = 0
                        val fullResponseBuilder = StringBuilder()
                        
                        conversation.sendMessageAsync(message)
                            .onEach { partialMessage ->
                                 val text = partialMessage.contents.contents
                                     .filterIsInstance<com.google.ai.edge.litertlm.Content.Text>()
                                     .joinToString("") { it.text }
                                 
                                 val thoughtText = partialMessage.channels["thought"]
                                 
                                 totalLength += text.length
                                 fullResponseBuilder.append(text)
                                 
                                 if (thoughtText != null && thoughtText.isNotEmpty()) {
                                     // Also append thought text to full response for cache history if needed
                                     // fullResponseBuilder.append(thoughtText)
                                 }

                                 val chunk = JSObject().apply {
                                     put("text", text)
                                     put("done", false)
                                     if (thoughtText != null && thoughtText.isNotEmpty()) {
                                         put("thinkingText", thoughtText)
                                     }
                                 }
                                 activeStreamingCall?.resolve(chunk)
                            }
                            .onCompletion { cause ->
                                 // Log.d(TAG, "Streaming completed. Total received length: $totalLength. Content: ${fullResponseBuilder.toString()}. Cause: $cause")
                                 isGenerating.set(false) 
                                 val finalResult = JSObject().apply {
                                     put("text", "") 
                                     put("done", true)
                                 }
                                 // Disable keep-alive for the final message
                                 activeStreamingCall?.setKeepAlive(false)
                                 activeStreamingCall?.resolve(finalResult)
                                 activeStreamingCall = null
                            }
                            .catch { e ->
                                 isGenerating.set(false) 
                                 Log.e(TAG, "Streaming exception flow: ${e.message}", e)
                                 activeStreamingCall?.reject("Streaming failed: ${e.message}")
                                 activeStreamingCall = null
                            }
                            .collect()
                        
                        // Increment message count after successful stream
                        if (storeChats) {
                             mutex.withLock {
                                val fullResponseMessage = com.google.ai.edge.litertlm.Message.of(
                                    listOf(com.google.ai.edge.litertlm.Content.Text(fullResponseBuilder.toString()))
                                )
                                conversationHistory.add(message)
                                conversationHistory.add(fullResponseMessage)
                                messageCount = conversationHistory.size
                             }
                        }

                        // Log.d(TAG, "Flow collection finished")
                    }
                }
            } catch (e: Exception) {
                isGenerating.set(false) 
                Log.e(TAG, "Streaming setup failed: ${e.message}", e)
                call.reject("Streaming setup failed: ${e.message}")
                activeStreamingCall = null
            } finally {
                isGenerating.set(false)
            }
        }
    }

    @PluginMethod
    fun stopGeneration(call: PluginCall) {
        // Bug #2 Fix: Signal the NATIVE runtime to stop inference first.
        // Previously only the Kotlin coroutine was cancelled, leaving the native LiteRT
        // engine running — causing "Another generation is in progress" on the next call.
        // cancelProcess() is non-blocking and safe to call from any thread.
        try {
            currentConversation?.cancelProcess()
        } catch (e: Exception) {
            Log.w(TAG, "cancelProcess() failed (safe to ignore): ${e.message}")
        }
        // Cancel the coroutine job
        activeGenerationJob?.cancel()
        activeStreamingCall = null
        isGenerating.set(false)
        call.resolve(JSObject().apply { put("success", true) })
    }

    @PluginMethod
    fun releaseModel(call: PluginCall) {
         // Cancel any active generation first
         runBlocking {
            activeGenerationJob?.cancel()
            activeGenerationJob?.join()
         }
         
         scope.launch {
            withContext(Dispatchers.IO) {
                    mutex.withLock {
                    try {
                        currentConversation?.close()
                    } catch (e: Exception) {
                        Log.w(TAG, "Error closing conversation during releaseModel: ${e.message}")
                    }
                    currentConversation = null
                    
                    try {
                        engine?.close()
                    } catch (e: Exception) {
                        Log.w(TAG, "Error closing engine during releaseModel: ${e.message}")
                    }
                    engine = null
                    currentModelPath = null
                }
                activeStreamingCall = null
            }
            call.resolve(JSObject().apply { put("success", true) })
         }
    }
    
    @PluginMethod
    fun isModelLoaded(call: PluginCall) {
         scope.launch {
            withContext(Dispatchers.IO) {
                    mutex.withLock {
                     val result = JSObject().apply {
                        put("isLoaded", engine != null)
                        put("modelPath", currentModelPath)
                     }
                     call.resolve(result)
                }
            }
         }
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
            withContext(Dispatchers.IO) {
                mutex.withLock {
                    try {
                        currentConversation?.close()
                    } catch (e: Exception) {
                        Log.w(TAG, "Error closing conversation: ${e.message}")
                    }
                    currentConversation = null
                    conversationHistory.clear()
                    messageCount = 0
                    System.gc()
                    System.runFinalization()
                    Log.i(TAG, "Session released and closed")
                }
            }
            call.resolve(JSObject().apply { put("success", true) })
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
            val success = mutex.withLock {
                persistenceManager?.saveConversation(conversationId, conversationHistory) ?: false
            }
            if (success) {
                call.resolve(JSObject().apply { put("success", true) })
            } else {
                call.reject("Failed to save KV Cache history")
            }
        }
    }

    @OptIn(ExperimentalApi::class)
    @PluginMethod
    fun restoreKvCache(call: PluginCall) {
        val conversationId = call.getString("conversationId") ?: "default"
        val currentEngine = engine
        if (currentEngine == null) {
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

                withContext(Dispatchers.IO) {
                    mutex.withLock {
                        // Close existing conversation if any
                        currentConversation?.close()
                        
                        // Create new conversation
                        val conversation = currentEngine.createConversation(
                            ConversationConfig(
                                samplerConfig = SamplerConfig(
                                    topK = 40,
                                    topP = 0.95,
                                    temperature = 0.8
                                )
                            )
                        )
                        
                        // "Prefill" the conversation with restored messages
                        Log.i(TAG, "Restoring ${restoredMessages.size} messages to rebuild KV Cache...")
                        
                        // We send messages in pairs (user/assistant) or as they are
                        // LiteRT sendMessage rebuilds the state
                        for (msg in restoredMessages) {
                            // Note: for restoration we might want a "silent" send if LiteRT supported it,
                            // but currently we just re-send them.
                            // To speed up, we could potentially batch them if LiteRT supported it.
                            conversation.sendMessage(msg)
                        }
                        
                        currentConversation = conversation
                        conversationHistory.clear()
                        conversationHistory.addAll(restoredMessages)
                        messageCount = conversationHistory.size
                    }
                }
                call.resolve(JSObject().apply { 
                    put("success", true) 
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
     * This bypasses the LiteRT 1-clip limitation by making multiple calls
     */
    private suspend fun processAudioChunksSequentially(
        engine: Engine,
        chunks: List<ByteArray>,
        bitmaps: List<android.graphics.Bitmap>,
        originalPrompt: String
    ) {
        val totalChunks = chunks.size
        val chunkResponses = mutableListOf<String>()
        
        // Send initial progress message
        val progressStart = JSObject().apply {
            put("text", "📊 Processing ${totalChunks} audio segments (${totalChunks * 30}s total)...\n\n")
            put("done", false)
        }
        activeStreamingCall?.resolve(progressStart)
        
        // Process each chunk
        for ((index, chunk) in chunks.withIndex()) {
            val chunkNum = index + 1
            // Log.d(TAG, "Processing chunk $chunkNum/$totalChunks (${chunk.size} bytes)")
            
            // Send chunk progress
            val chunkProgress = JSObject().apply {
                put("text", "🎵 Segment $chunkNum/$totalChunks: ")
                put("done", false)
            }
            activeStreamingCall?.resolve(chunkProgress)
            
            try {
                // Create new conversation for this chunk
                val conversation = engine.createConversation(
                    ConversationConfig(
                        samplerConfig = SamplerConfig(
                            topK = 40,
                            topP = 0.95,
                            temperature = 0.8
                        )
                    )
                )
                
                // Build content for this chunk
                val contents = mutableListOf<com.google.ai.edge.litertlm.Content>()
                contents.add(com.google.ai.edge.litertlm.Content.AudioBytes(chunk))
                contents.add(com.google.ai.edge.litertlm.Content.Text("Transcribe and summarize this audio segment briefly:"))
                
                val message = com.google.ai.edge.litertlm.Message.of(contents)
                
                // Collect response for this chunk
                val chunkResponse = StringBuilder()
                try {
                    conversation.sendMessageAsync(message)
                        .collect { partialMessage ->
                            val text = partialMessage.contents.contents
                                .filterIsInstance<com.google.ai.edge.litertlm.Content.Text>()
                                .joinToString("") { it.text }
                            chunkResponse.append(text)
                            
                            // Stream partial response
                            val partial = JSObject().apply {
                                put("text", text)
                                put("done", false)
                            }
                            activeStreamingCall?.resolve(partial)
                        }
                } finally {
                    try {
                        conversation.close()
                    } catch (ce: Exception) {
                        Log.e(TAG, "Error closing chunk conversation: ${ce.message}")
                    }
                }
                
                val responseText = chunkResponse.toString().trim()
                chunkResponses.add(responseText)
                // Log.d(TAG, "Chunk $chunkNum response: ${responseText.take(100)}...")
                
                // Add newline after each chunk
                val newline = JSObject().apply {
                    put("text", "\n\n")
                    put("done", false)
                }
                activeStreamingCall?.resolve(newline)
                
            } catch (e: Exception) {
                Log.e(TAG, "Error processing chunk $chunkNum: ${e.message}")
                val errorMsg = JSObject().apply {
                    put("text", "[Error in segment $chunkNum]\n\n")
                    put("done", false)
                }
                activeStreamingCall?.resolve(errorMsg)
            }
        }
        
        // If user wanted a summary, combine all chunk responses
        if (originalPrompt.lowercase().contains("summar") || 
            originalPrompt.lowercase().contains("sommario") ||
            chunkResponses.size > 3) {
            
            // Log.d(TAG, "Creating final summary from ${chunkResponses.size} chunk responses")
            
            val summaryHeader = JSObject().apply {
                put("text", "\n---\n📝 **Overall Summary:**\n")
                put("done", false)
            }
            activeStreamingCall?.resolve(summaryHeader)
            
            try {
                // Create final conversation for summary
                val summaryConversation = engine.createConversation(
                    ConversationConfig(
                        samplerConfig = SamplerConfig(
                            topK = 40,
                            topP = 0.95,
                            temperature = 0.8
                        )
                    )
                )
                
                val combinedText = chunkResponses.mapIndexed { i, r -> 
                    "Segment ${i+1}: $r"
                }.joinToString("\n\n")
                
                val summaryContents = mutableListOf<com.google.ai.edge.litertlm.Content>()
                summaryContents.add(com.google.ai.edge.litertlm.Content.Text(
                    "Here are transcriptions from ${chunkResponses.size} audio segments. Create a brief overall summary:\n\n$combinedText"
                ))
                
                val summaryMessage = com.google.ai.edge.litertlm.Message.of(summaryContents)
                
                try {
                    summaryConversation.sendMessageAsync(summaryMessage)
                        .collect { partialMessage ->
                            val text = partialMessage.contents.contents
                                .filterIsInstance<com.google.ai.edge.litertlm.Content.Text>()
                                .joinToString("") { it.text }
                            val partial = JSObject().apply {
                                put("text", text)
                                put("done", false)
                            }
                            activeStreamingCall?.resolve(partial)
                        }
                } finally {
                    try {
                        summaryConversation.close()
                    } catch (ce: Exception) {
                        Log.e(TAG, "Error closing summary conversation: ${ce.message}")
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error creating summary: ${e.message}")
            }
        }
        
        // Final completion
        val finalResult = JSObject().apply {
            put("text", "")
            put("done", true)
        }
        activeStreamingCall?.setKeepAlive(false)
        activeStreamingCall?.resolve(finalResult)
        activeStreamingCall = null
        
        // Log.d(TAG, "Multi-chunk processing completed: $totalChunks chunks processed")
    }


    private fun decodeAudioToPcm(audioPath: String, context: Context): ByteArray? {
        try {
            val extractor = android.media.MediaExtractor()
            if (audioPath.startsWith("content://")) {
                val uri = android.net.Uri.parse(audioPath)
                val fd = context.contentResolver.openFileDescriptor(uri, "r")?.fileDescriptor ?: return null
                extractor.setDataSource(fd)
            } else {
                val cleanPath = if (audioPath.startsWith("file://")) audioPath.substring(7) else audioPath
                extractor.setDataSource(cleanPath)
            }

            var inputFormat: android.media.MediaFormat? = null
            var trackIndex = -1
            for (i in 0 until extractor.trackCount) {
                val format = extractor.getTrackFormat(i)
                val mime = format.getString(android.media.MediaFormat.KEY_MIME)
                if (mime?.startsWith("audio/") == true) {
                    inputFormat = format
                    trackIndex = i
                    break
                }
            }

            if (trackIndex < 0 || inputFormat == null) {
                Log.e(TAG, "No audio track found in $audioPath")
                return null
            }

            extractor.selectTrack(trackIndex)
            val decoder = android.media.MediaCodec.createDecoderByType(inputFormat.getString(android.media.MediaFormat.KEY_MIME)!!)
            decoder.configure(inputFormat, null, null, 0)
            decoder.start()

            val bufferInfo = android.media.MediaCodec.BufferInfo()
            val outputStream = java.io.ByteArrayOutputStream()
            var isEOS = false
            
            // Default to input format, but update if output format changes
            var sampleRate = inputFormat.getInteger(android.media.MediaFormat.KEY_SAMPLE_RATE)
            var channelCount = if (inputFormat.containsKey(android.media.MediaFormat.KEY_CHANNEL_COUNT)) 
                inputFormat.getInteger(android.media.MediaFormat.KEY_CHANNEL_COUNT) else 1

            while (true) {
                if (!isEOS) {
                    val inIndex = decoder.dequeueInputBuffer(10000)
                    if (inIndex >= 0) {
                        val buffer = decoder.getInputBuffer(inIndex)
                        val sampleSize = extractor.readSampleData(buffer!!, 0)
                        if (sampleSize < 0) {
                            decoder.queueInputBuffer(inIndex, 0, 0, 0, android.media.MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            isEOS = true
                        } else {
                            decoder.queueInputBuffer(inIndex, 0, sampleSize, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                }

                val outIndex = decoder.dequeueOutputBuffer(bufferInfo, 10000)
                if (outIndex >= 0) {
                    val outBuffer = decoder.getOutputBuffer(outIndex)
                    val chunk = ByteArray(bufferInfo.size)
                    outBuffer!!.get(chunk)
                    outBuffer.clear()
                    outputStream.write(chunk)
                    decoder.releaseOutputBuffer(outIndex, false)
                } else if (outIndex == android.media.MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    val newFormat = decoder.outputFormat
                    // Log.d(TAG, "Output format changed: $newFormat")
                    if (newFormat.containsKey(android.media.MediaFormat.KEY_SAMPLE_RATE)) {
                        sampleRate = newFormat.getInteger(android.media.MediaFormat.KEY_SAMPLE_RATE)
                    }
                    if (newFormat.containsKey(android.media.MediaFormat.KEY_CHANNEL_COUNT)) {
                        channelCount = newFormat.getInteger(android.media.MediaFormat.KEY_CHANNEL_COUNT)
                    }
                } else if (outIndex == android.media.MediaCodec.INFO_TRY_AGAIN_LATER) {
                    if (isEOS) break
                }
            }
            
            decoder.stop()
            decoder.release()
            extractor.release()
            
            val pcmData = outputStream.toByteArray()
            // Log.d(TAG, "Decoded PCM size: ${pcmData.size}, SampleRate: $sampleRate, Channels: $channelCount")
            
            return addWavHeader(pcmData, sampleRate, channelCount)
        } catch (e: Exception) {
            Log.e(TAG, "Error decoding audio: ${e.message}")
            return null
        }
    }

    /**
     * Decode audio and split into 30-second chunks for Gemma 3n
     * Returns list of WAV-formatted byte arrays, each ≤30 seconds
     */
    private fun decodeAndChunkAudio(audioPath: String, context: Context): List<ByteArray> {
        val pcmData = decodeAudioToPcmRaw(audioPath, context) ?: return emptyList()
        
        val sampleRate = pcmData.sampleRate
        val channelCount = pcmData.channelCount
        val rawPcm = pcmData.data
        
        val TARGET_SAMPLE_RATE = 16000
        val CHUNK_SECONDS = 30
        val SAMPLES_PER_CHUNK = TARGET_SAMPLE_RATE * CHUNK_SECONDS
        
        // Convert to samples
        val numSamples = rawPcm.size / 2
        val samples = ShortArray(numSamples)
        for (i in 0 until numSamples) {
            val lo = rawPcm[i * 2].toInt() and 0xFF
            val hi = rawPcm[i * 2 + 1].toInt()
            samples[i] = ((hi shl 8) or lo).toShort()
        }
        
        // Convert stereo to mono
        val monoSamples = if (channelCount > 1) {
            val monoLen = samples.size / channelCount
            ShortArray(monoLen) { i ->
                var sum = 0
                for (ch in 0 until channelCount) {
                    sum += samples[i * channelCount + ch].toInt()
                }
                (sum / channelCount).toShort()
            }
        } else {
            samples
        }
        
        // Resample to 16kHz
        val resampledSamples = if (sampleRate != TARGET_SAMPLE_RATE) {
            resample(monoSamples, sampleRate, TARGET_SAMPLE_RATE)
        } else {
            monoSamples
        }
        
        val totalDuration = resampledSamples.size.toFloat() / TARGET_SAMPLE_RATE
        // Log.d(TAG, "Audio duration: ${String.format("%.1f", totalDuration)} seconds, will create ${kotlin.math.ceil(resampledSamples.size.toDouble() / SAMPLES_PER_CHUNK).toInt()} chunks")
        
        // Split into chunks
        val chunks = mutableListOf<ByteArray>()
        var offset = 0
        var chunkNum = 1
        
        while (offset < resampledSamples.size) {
            val remainingSamples = resampledSamples.size - offset
            val chunkSamples = minOf(remainingSamples, SAMPLES_PER_CHUNK)
            
            // Extract chunk samples
            val chunkData = ShortArray(chunkSamples)
            System.arraycopy(resampledSamples, offset, chunkData, 0, chunkSamples)
            
            // Convert to bytes
            val pcmBytes = ByteArray(chunkSamples * 2)
            for (i in 0 until chunkSamples) {
                val sample = chunkData[i].toInt()
                pcmBytes[i * 2] = (sample and 0xFF).toByte()
                pcmBytes[i * 2 + 1] = ((sample shr 8) and 0xFF).toByte()
            }
            
            // Create WAV with header
            val wavData = createWavFile(pcmBytes, TARGET_SAMPLE_RATE)
            chunks.add(wavData)
            
            val chunkDuration = chunkSamples.toFloat() / TARGET_SAMPLE_RATE
            // Log.d(TAG, "Chunk $chunkNum: ${String.format("%.1f", chunkDuration)}s, ${wavData.size} bytes")
            
            offset += chunkSamples
            chunkNum++
        }
        
        return chunks
    }
    
    /**
     * Raw PCM data with metadata
     */
    private data class RawPcmData(val data: ByteArray, val sampleRate: Int, val channelCount: Int)
    
    /**
     * Decode audio to raw PCM without resampling or WAV header
     */
    private fun decodeAudioToPcmRaw(audioPath: String, context: Context): RawPcmData? {
        try {
            val extractor = android.media.MediaExtractor()
            if (audioPath.startsWith("content://")) {
                val uri = android.net.Uri.parse(audioPath)
                val fd = context.contentResolver.openFileDescriptor(uri, "r")?.fileDescriptor ?: return null
                extractor.setDataSource(fd)
            } else {
                val cleanPath = if (audioPath.startsWith("file://")) audioPath.substring(7) else audioPath
                extractor.setDataSource(cleanPath)
            }

            var inputFormat: android.media.MediaFormat? = null
            var trackIndex = -1
            for (i in 0 until extractor.trackCount) {
                val format = extractor.getTrackFormat(i)
                val mime = format.getString(android.media.MediaFormat.KEY_MIME)
                if (mime?.startsWith("audio/") == true) {
                    inputFormat = format
                    trackIndex = i
                    break
                }
            }

            if (trackIndex < 0 || inputFormat == null) {
                Log.e(TAG, "No audio track found in $audioPath")
                return null
            }

            extractor.selectTrack(trackIndex)
            val decoder = android.media.MediaCodec.createDecoderByType(inputFormat.getString(android.media.MediaFormat.KEY_MIME)!!)
            decoder.configure(inputFormat, null, null, 0)
            decoder.start()

            val bufferInfo = android.media.MediaCodec.BufferInfo()
            val outputStream = java.io.ByteArrayOutputStream()
            var isEOS = false
            
            var sampleRate = inputFormat.getInteger(android.media.MediaFormat.KEY_SAMPLE_RATE)
            var channelCount = if (inputFormat.containsKey(android.media.MediaFormat.KEY_CHANNEL_COUNT)) 
                inputFormat.getInteger(android.media.MediaFormat.KEY_CHANNEL_COUNT) else 1

            while (true) {
                if (!isEOS) {
                    val inIndex = decoder.dequeueInputBuffer(10000)
                    if (inIndex >= 0) {
                        val buffer = decoder.getInputBuffer(inIndex)
                        val sampleSize = extractor.readSampleData(buffer!!, 0)
                        if (sampleSize < 0) {
                            decoder.queueInputBuffer(inIndex, 0, 0, 0, android.media.MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            isEOS = true
                        } else {
                            decoder.queueInputBuffer(inIndex, 0, sampleSize, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                }

                val outIndex = decoder.dequeueOutputBuffer(bufferInfo, 10000)
                if (outIndex >= 0) {
                    val outBuffer = decoder.getOutputBuffer(outIndex)
                    val chunk = ByteArray(bufferInfo.size)
                    outBuffer!!.get(chunk)
                    outBuffer.clear()
                    outputStream.write(chunk)
                    decoder.releaseOutputBuffer(outIndex, false)
                } else if (outIndex == android.media.MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    val newFormat = decoder.outputFormat
                    if (newFormat.containsKey(android.media.MediaFormat.KEY_SAMPLE_RATE)) {
                        sampleRate = newFormat.getInteger(android.media.MediaFormat.KEY_SAMPLE_RATE)
                    }
                    if (newFormat.containsKey(android.media.MediaFormat.KEY_CHANNEL_COUNT)) {
                        channelCount = newFormat.getInteger(android.media.MediaFormat.KEY_CHANNEL_COUNT)
                    }
                } else if (outIndex == android.media.MediaCodec.INFO_TRY_AGAIN_LATER) {
                    if (isEOS) break
                }
            }
            
            decoder.stop()
            decoder.release()
            extractor.release()
            
            val pcmData = outputStream.toByteArray()
            Log.d(TAG, "Decoded raw PCM: ${pcmData.size} bytes, ${sampleRate}Hz, ${channelCount}ch")
            
            return RawPcmData(pcmData, sampleRate, channelCount)
        } catch (e: Exception) {
            Log.e(TAG, "Error decoding audio: ${e.message}")
            return null
        }
    }
    
    /**
     * Create WAV file from 16kHz mono PCM16 data
     */
    private fun createWavFile(pcmData: ByteArray, sampleRate: Int): ByteArray {
        val totalDataLen = pcmData.size.toLong()
        val byteRate = sampleRate * 2  // 16-bit mono
        
        val header = ByteArray(44)
        
        // RIFF header
        header[0] = 'R'.code.toByte()
        header[1] = 'I'.code.toByte()
        header[2] = 'F'.code.toByte()
        header[3] = 'F'.code.toByte()
        
        // Match gallery format: wavFileSize = pcmDataSize + 44 (full file size)
        val wavFileSize = totalDataLen + 44
        header[4] = (wavFileSize and 0xff).toByte()
        header[5] = ((wavFileSize shr 8) and 0xff).toByte()
        header[6] = ((wavFileSize shr 16) and 0xff).toByte()
        header[7] = ((wavFileSize shr 24) and 0xff).toByte()
        
        header[8] = 'W'.code.toByte()
        header[9] = 'A'.code.toByte()
        header[10] = 'V'.code.toByte()
        header[11] = 'E'.code.toByte()
        header[12] = 'f'.code.toByte()
        header[13] = 'm'.code.toByte()
        header[14] = 't'.code.toByte()
        header[15] = ' '.code.toByte()
        
        header[16] = 16; header[17] = 0; header[18] = 0; header[19] = 0
        header[20] = 1; header[21] = 0  // PCM format
        header[22] = 1; header[23] = 0  // Mono
        
        header[24] = (sampleRate and 0xff).toByte()
        header[25] = ((sampleRate shr 8) and 0xff).toByte()
        header[26] = ((sampleRate shr 16) and 0xff).toByte()
        header[27] = ((sampleRate shr 24) and 0xff).toByte()
        
        header[28] = (byteRate and 0xff).toByte()
        header[29] = ((byteRate shr 8) and 0xff).toByte()
        header[30] = ((byteRate shr 16) and 0xff).toByte()
        header[31] = ((byteRate shr 24) and 0xff).toByte()
        
        header[32] = 2; header[33] = 0  // Block align
        header[34] = 16; header[35] = 0  // Bits per sample
        
        header[36] = 'd'.code.toByte()
        header[37] = 'a'.code.toByte()
        header[38] = 't'.code.toByte()
        header[39] = 'a'.code.toByte()
        
        header[40] = (totalDataLen and 0xff).toByte()
        header[41] = ((totalDataLen shr 8) and 0xff).toByte()
        header[42] = ((totalDataLen shr 16) and 0xff).toByte()
        header[43] = ((totalDataLen shr 24) and 0xff).toByte()
        
        return header + pcmData
    }

    /**
     * Convert 16-bit PCM audio to Gemma 3n format:
     * - Mono channel
     * - 16 kHz sample rate
     * - Float32 samples in range [-1, 1]
     */
    private fun convertToGemma3nFormat(pcmData: ByteArray, sampleRate: Int, channelCount: Int): ByteArray {
        val TARGET_SAMPLE_RATE = 16000
        
        // Step 1: Convert bytes to 16-bit samples
        val numSamples = pcmData.size / 2
        val samples = ShortArray(numSamples)
        for (i in 0 until numSamples) {
            val lo = pcmData[i * 2].toInt() and 0xFF
            val hi = pcmData[i * 2 + 1].toInt()
            samples[i] = ((hi shl 8) or lo).toShort()
        }
        
        // Step 2: Convert stereo to mono if needed
        val monoSamples = if (channelCount > 1) {
            val monoLen = samples.size / channelCount
            ShortArray(monoLen) { i ->
                var sum = 0
                for (ch in 0 until channelCount) {
                    sum += samples[i * channelCount + ch].toInt()
                }
                (sum / channelCount).toShort()
            }
        } else {
            samples
        }
        
        // Step 3: Resample to 16kHz if needed
        val resampledSamples = if (sampleRate != TARGET_SAMPLE_RATE) {
            resample(monoSamples, sampleRate, TARGET_SAMPLE_RATE)
        } else {
            monoSamples
        }
        
        // Step 4: Convert to float32 in range [-1, 1]
        val floatBuffer = java.nio.ByteBuffer.allocate(resampledSamples.size * 4)
        floatBuffer.order(java.nio.ByteOrder.LITTLE_ENDIAN)
        for (sample in resampledSamples) {
            val normalized = sample.toFloat() / 32768f  // Normalize to [-1, 1]
            floatBuffer.putFloat(normalized)
        }
        
        val result = floatBuffer.array()
        Log.d(TAG, "Converted to Gemma 3n format: ${result.size} bytes (${resampledSamples.size} float32 samples at 16kHz mono)")
        return result
    }
    
    /**
     * Simple linear interpolation resampling
     */
    private fun resample(input: ShortArray, fromRate: Int, toRate: Int): ShortArray {
        val ratio = fromRate.toDouble() / toRate.toDouble()
        val outputLen = (input.size / ratio).toInt()
        val output = ShortArray(outputLen)
        
        for (i in 0 until outputLen) {
            val srcPos = i * ratio
            val srcIndex = srcPos.toInt()
            val frac = srcPos - srcIndex
            
            val sample1 = input[minOf(srcIndex, input.size - 1)].toInt()
            val sample2 = input[minOf(srcIndex + 1, input.size - 1)].toInt()
            
            output[i] = (sample1 + (sample2 - sample1) * frac).toInt().toShort()
        }
        
        Log.d(TAG, "Resampled from $fromRate Hz to $toRate Hz: ${input.size} -> ${output.size} samples")
        return output
    }

    /**
     * Create a WAV file with 16kHz mono PCM16 format for Gemma 3n
     * This format is required by LiteRT's miniaudio decoder
     */
    private fun addWavHeader(pcmData: ByteArray, sampleRate: Int, channels: Int): ByteArray {
        val TARGET_SAMPLE_RATE = 16000
        
        // Step 1: Convert bytes to 16-bit samples
        val numSamples = pcmData.size / 2
        val samples = ShortArray(numSamples)
        for (i in 0 until numSamples) {
            val lo = pcmData[i * 2].toInt() and 0xFF
            val hi = pcmData[i * 2 + 1].toInt()
            samples[i] = ((hi shl 8) or lo).toShort()
        }
        
        // Step 2: Convert stereo to mono if needed
        val monoSamples = if (channels > 1) {
            val monoLen = samples.size / channels
            ShortArray(monoLen) { i ->
                var sum = 0
                for (ch in 0 until channels) {
                    sum += samples[i * channels + ch].toInt()
                }
                (sum / channels).toShort()
            }
        } else {
            samples
        }
        
        // Step 3: Resample to 16kHz if needed
        val resampledSamples = if (sampleRate != TARGET_SAMPLE_RATE) {
            resample(monoSamples, sampleRate, TARGET_SAMPLE_RATE)
        } else {
            monoSamples
        }
        
        // Step 4: Convert back to bytes
        val resampledPcm = ByteArray(resampledSamples.size * 2)
        for (i in resampledSamples.indices) {
            val sample = resampledSamples[i].toInt()
            resampledPcm[i * 2] = (sample and 0xFF).toByte()
            resampledPcm[i * 2 + 1] = ((sample shr 8) and 0xFF).toByte()
        }
        
        Log.d(TAG, "Prepared audio for Gemma 3n: ${resampledPcm.size} bytes PCM, ${resampledSamples.size} samples at 16kHz mono")
        
        // Step 5: Create WAV header for 16kHz mono 16-bit PCM
        val totalDataLen = resampledPcm.size.toLong()
        val byteRate = (16 * TARGET_SAMPLE_RATE * 1) / 8  // 16-bit, 16kHz, mono
        
        val header = ByteArray(44)
        
        // RIFF header
        header[0] = 'R'.code.toByte()
        header[1] = 'I'.code.toByte()
        header[2] = 'F'.code.toByte()
        header[3] = 'F'.code.toByte()
        
        // Match gallery format: wavFileSize = pcmDataSize + 44 (full file size)
        val wavFileSize = totalDataLen + 44
        header[4] = (wavFileSize and 0xff).toByte()
        header[5] = ((wavFileSize shr 8) and 0xff).toByte()
        header[6] = ((wavFileSize shr 16) and 0xff).toByte()
        header[7] = ((wavFileSize shr 24) and 0xff).toByte()
        
        // WAVE format
        header[8] = 'W'.code.toByte()
        header[9] = 'A'.code.toByte()
        header[10] = 'V'.code.toByte()
        header[11] = 'E'.code.toByte()
        
        // fmt subchunk
        header[12] = 'f'.code.toByte()
        header[13] = 'm'.code.toByte()
        header[14] = 't'.code.toByte()
        header[15] = ' '.code.toByte()
        
        // Subchunk1Size (16 for PCM)
        header[16] = 16
        header[17] = 0
        header[18] = 0
        header[19] = 0
        
        // AudioFormat (1 = PCM)
        header[20] = 1
        header[21] = 0
        
        // NumChannels (1 = mono)
        header[22] = 1
        header[23] = 0
        
        // SampleRate (16000)
        header[24] = (TARGET_SAMPLE_RATE and 0xff).toByte()
        header[25] = ((TARGET_SAMPLE_RATE shr 8) and 0xff).toByte()
        header[26] = ((TARGET_SAMPLE_RATE shr 16) and 0xff).toByte()
        header[27] = ((TARGET_SAMPLE_RATE shr 24) and 0xff).toByte()
        
        // ByteRate
        header[28] = (byteRate and 0xff).toByte()
        header[29] = ((byteRate shr 8) and 0xff).toByte()
        header[30] = ((byteRate shr 16) and 0xff).toByte()
        header[31] = ((byteRate shr 24) and 0xff).toByte()
        
        // BlockAlign (2 = 16-bit mono)
        header[32] = 2
        header[33] = 0
        
        // BitsPerSample (16)
        header[34] = 16
        header[35] = 0
        
        // data subchunk
        header[36] = 'd'.code.toByte()
        header[37] = 'a'.code.toByte()
        header[38] = 't'.code.toByte()
        header[39] = 'a'.code.toByte()
        
        // Subchunk2Size
        header[40] = (totalDataLen and 0xff).toByte()
        header[41] = ((totalDataLen shr 8) and 0xff).toByte()
        header[42] = ((totalDataLen shr 16) and 0xff).toByte()
        header[43] = ((totalDataLen shr 24) and 0xff).toByte()
        
        Log.d(TAG, "Created WAV file: ${header.size + resampledPcm.size} bytes total (16kHz mono PCM16)")
        return header + resampledPcm
    }
}
