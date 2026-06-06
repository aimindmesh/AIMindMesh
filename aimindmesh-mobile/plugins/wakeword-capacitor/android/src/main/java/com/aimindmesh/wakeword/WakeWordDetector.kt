package com.aimindmesh.wakeword

import android.content.Context
import android.util.Log
import org.tensorflow.lite.Interpreter
import java.io.File
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel

/**
 * Wake word detector using OpenWakeWord TFLite models.
 * 
 * Pipeline:
 * 1. Audio (80ms chunks @ 16kHz) → melspectrogram.tflite → Mel features [1, 1, 96, 64]
 * 2. Mel features → embedding_model.tflite → Embeddings [1, 1, 96]
 * 3. Embeddings (stacked) → wake_word.tflite → Score [0.0 - 1.0]
 * 
 * Based on: https://github.com/dscripka/openWakeWord
 */
class WakeWordDetector(private val context: Context) {
    
    companion object {
        private const val TAG = "WakeWordDetector"
        
        // Audio parameters (OpenWakeWord standard)
        const val SAMPLE_RATE = 16000
        const val CHUNK_SAMPLES = 1280  // 80ms @ 16kHz
        
        // Model input/output dimensions (from OpenWakeWord)
        // These may need adjustment based on actual model inspection
        private const val MEL_FEATURES_SIZE = 96 * 64  // Mel spectrogram output
        private const val EMBEDDING_DIM = 96           // Embedding vector size
        private const val EMBEDDING_WINDOW = 16        // Number of embeddings for temporal context
        
        // Training parameters
        private const val TRAIN_RMS_THRESHOLD = 0.001f // Relaxed from 0.005f to match Vosk's sensitivity
        
        // Robustness parameters (ported from SpeakerEmbedding.ts)
        private const val MIN_EMBEDDING_MAGNITUDE = 0.05f // Relaxed from 0.10f to allow quiet speech
        private const val REJECTION_THRESHOLD = 0.05f    // Relaxed from 0.10f for higher sensitivity
    }
    
    // TFLite interpreters for the 3-stage pipeline
    private var melInterpreter: Interpreter? = null
    private var embeddingInterpreter: Interpreter? = null
    private var wakeWordInterpreter: Interpreter? = null
    
    // Model buffers and streams (Pinned as class members to prevent native detachment/GC)
    private var melModelBuffer: MappedByteBuffer? = null
    private var embeddingModelBuffer: MappedByteBuffer? = null
    private var wakeWordModelBuffer: MappedByteBuffer? = null
    
    // Persistent Array Buffers (Object Bridge) - Pinned as class members for stability
    private var melOutputArray = Array(1) { Array(1) { Array(5) { FloatArray(32) } } } // [1, 1, 5, 32]
    private var melInputArray = Array(1) { FloatArray(CHUNK_SAMPLES) }                 // [1, 1280]

    // VAD Integration
    private val vad = SileroVAD(context)
    private var vadBuffer = FloatArray(0) // Accumulator for VAD chunks (512 samples)
    private var isVadEnabled = false
    private var lastVadProb = 0f
    private var wasSpeech = false
    
    // Feature accumulation buffer (To bridge Mel output to Embedding window)
    private var melFeaturesBuffer = Array(96) { FloatArray(32) }
    private var melBufferIndex = 0
    
    // Embedding model buffers [1, 76, 32, 1] -> [1, 1, 1, 96]
    // Using Direct ByteBuffers to avoid array shape headaches with [32, 1] last dims
    private val embInputBuffer: ByteBuffer = ByteBuffer.allocateDirect(1 * 76 * 32 * 1 * 4).order(ByteOrder.nativeOrder())
    private val embOutputBuffer: ByteBuffer = ByteBuffer.allocateDirect(1 * 1 * 1 * 96 * 4).order(ByteOrder.nativeOrder())
    
    // Wake word model buffers [1, 16, 96] -> [1, 1]
    private var wwInputArray = Array(1) { Array(EMBEDDING_WINDOW) { FloatArray(EMBEDDING_DIM) } } 
    private var wwOutputArray = Array(1) { FloatArray(1) }                                       
    
    // Custom Training / verification
    private val customTemplates = mutableMapOf<String, FloatArray>()
    private var trainingSamples = mutableListOf<FloatArray>()
    private var trainingSessionEmbeddings = mutableListOf<Pair<FloatArray, Float>>() // Embeddings + RMS
    private var isTraining = false
    private var isCustomModel = false
    private val currentRecordingAudio = java.io.ByteArrayOutputStream()
    
    // Silence reference
    private var silenceEmbedding: FloatArray? = null
    
    // File streams held open to pin memory mappings
    
    // File streams held open to pin memory mappings
    private val pinnedStreams = mutableListOf<FileInputStream>()
    private val pinnedChannels = mutableListOf<FileChannel>()
    
    // Configuration
    private var threshold = 0.5f
    private var cooldownMs = 2000L
    private var bufferSize = 20
    private var lastDetectionTime = 0L
    private var currentModelName = ""
    private var debugMode = false 
    
    // Temporal consistency for custom wake words
    // Require N consecutive frames above threshold to reduce false positives
    // "Hey Atlas" is ~600-800ms, each frame is 80ms, so we need 8+ frames
    private var consecutiveDetections = 0
    private var minConsecutiveFrames = 8  // ~640ms of consistent detection required (configurable)
    
    fun setMinConsecutiveFrames(frames: Int) {
        minConsecutiveFrames = frames.coerceIn(3, 15)  // Reasonable range: 240ms - 1200ms
        Log.d(TAG, "Set minConsecutiveFrames to $minConsecutiveFrames")
    }
    
    fun getMinConsecutiveFrames(): Int = minConsecutiveFrames
    
    // Sliding window buffer for embeddings (temporal context)
    private val embeddingBuffer = ArrayDeque<FloatArray>(EMBEDDING_WINDOW)
    
    // Performance tracking
    private var totalInferenceTime = 0L
    private var inferenceCount = 0
    
    // Model loaded state
    private var modelsLoaded = false
    
    /**
     * Detection result from processing audio
     */
    data class DetectionResult(
        val detected: Boolean,
        val confidence: Float,
        val modelName: String
    )
    
    /**
     * Debug diagnostic result for analyzing wake word detection issues
     */
    data class DebugDiagnosticResult(
        val templateMagnitude: Float,
        val templateDimension: Int,
        val templateFirst10: FloatArray,
        val lastEmbeddingMagnitude: Float,
        val lastEmbeddingFirst10: FloatArray,
        val lastChunkSize: Int,
        val lastRms: Float,
        val lastSimilarity: Float,
        val currentThreshold: Float,
        val vadProbability: Float,
        val bufferSize: Int,
        val isMatch: Boolean,
        val enrollmentSampleCount: Int,
        val consecutiveDetections: Int,
        val minConsecutiveFrames: Int,
        val debugInfo: String
    )
    
    // Debug tracking for diagnostics
    private var lastDebugEmbedding: FloatArray? = null
    private var lastDebugRms: Float = 0f
    private var lastDebugSimilarity: Float = 0f
    private var lastDebugChunkSize: Int = 0
    
    /**
     * Load all required models for the wake word pipeline
     */
    fun loadModels(wakeWordModelName: String): Boolean {
        Log.i(TAG, "Loading models starting with: $wakeWordModelName")
        return try {
            val modelsDir = File(context.filesDir, "wakeword-models")
            if (!modelsDir.exists() || !modelsDir.isDirectory) {
                Log.e(TAG, "wakeword-models directory not found: ${modelsDir.absolutePath}")
                return false
            }

            // 1. Load melspectrogram model (STRATEGIC: XNNPACK MANDATORY)
            try {
                val melFile = File(modelsDir, "melspectrogram.tflite")
                checkFileExists(melFile)
                melModelBuffer = loadPinnedFile(melFile)
                
                Log.d(TAG, "Creating Mel Interpreter...")
                val melOptions = Interpreter.Options().apply {
                    setNumThreads(1)
                }
                val interpreter = Interpreter(melModelBuffer!!, melOptions)
                interpreter.resizeInput(0, intArrayOf(1, CHUNK_SAMPLES))
                interpreter.allocateTensors()
                melInterpreter = interpreter
                
                // Iteration 11: Comprehensive diagnostics
                if (debugMode) logModelInfo("melspectrogram", interpreter)
                
                Log.i(TAG, "✅ Mel spectrogram model loaded (XNNPACK)")
            } catch (t: Throwable) {
                Log.e(TAG, "❌ Failed to load melspectrogram model: ${t.message}")
                throw t
            }
            
            // Standard options for other stages
            val standardOptions = Interpreter.Options().apply {
                setNumThreads(1)
            }

            // 2. Load embedding model
            try {
                val embFile = File(modelsDir, "embedding_model.tflite")
                checkFileExists(embFile)
                embeddingModelBuffer = loadPinnedFile(embFile)
                Log.d(TAG, "Creating Embedding Interpreter...")
                val interpreter = Interpreter(embeddingModelBuffer!!, standardOptions).apply { allocateTensors() }
                embeddingInterpreter = interpreter
                if (debugMode) logModelInfo("embedding", interpreter)
                Log.i(TAG, "✅ Embedding model loaded")
            } catch (e: Exception) {
                Log.e(TAG, "❌ Failed to load embedding model: ${e.message}")
                throw e
            }
            
            if (wakeWordModelName.startsWith("custom:")) {
                // Load custom profile
                val profileName = wakeWordModelName.removePrefix("custom:")
                if (loadProfile(profileName)) {
                    currentModelName = wakeWordModelName
                    isCustomModel = true
                    // We still need mel and embedding models, which are loaded above
                    // Wake word interpreter is NOT used/loaded
                    modelsLoaded = true
                    warmUp()
                    
                    if (!verifyModelSanity(currentModelName)) {
                        Log.e(TAG, "❌ Custom model '$currentModelName' failed sanity check (too similar to silence). Disabling.")
                        modelsLoaded = false
                        currentModelName = ""
                        return false
                    }
                    
                    // Optimization: Try to load VAD model if not loaded
                    if (!vad.isLoaded) {
                        tryLoadVadModel()
                    }
                    
                    Log.i(TAG, "All models loaded successfully. VAD active: ${vad.isLoaded}")
                    return true
                } else {
                    Log.e(TAG, "Failed to load custom profile: $profileName")
                    return false
                }
            } else {
                if (wakeWordModelName == "TRAINING_MODE") {
                    Log.i(TAG, "Training mode: Skipping wake word model load")
                    modelsLoaded = true
                    warmUp()
                    
                    // Optimization: Try to load VAD model if not loaded
                    if (!vad.isLoaded) {
                        tryLoadVadModel()
                    }
                    
                    Log.i(TAG, "All models loaded successfully. VAD active: ${vad.isLoaded}")
                    return true
                }

                // 3. Load standard wake word model
                try {
                    val wwFile = File(modelsDir, wakeWordModelName)
                    checkFileExists(wwFile)
                    wakeWordModelBuffer = loadPinnedFile(wwFile)
                    Log.d(TAG, "Creating Wake Word Interpreter...")
                    val interpreter = Interpreter(wakeWordModelBuffer!!, standardOptions).apply { allocateTensors() }
                    wakeWordInterpreter = interpreter
                    if (debugMode) logModelInfo("wakeword", interpreter)
                    Log.i(TAG, "✅ Wake word model loaded: $wakeWordModelName")
                    
                    currentModelName = wakeWordModelName.removeSuffix(".tflite")
                    isCustomModel = false
                } catch (e: Exception) {
                    Log.e(TAG, "❌ Failed to load wake word model ($wakeWordModelName): ${e.message}")
                    throw e
                }
            }

            modelsLoaded = true
            warmUp()
            
            // Optimization: Try to load VAD model if not loaded
            if (!vad.isLoaded) {
                tryLoadVadModel()
            }
            
            Log.i(TAG, "All models loaded successfully. VAD active: ${vad.isLoaded}")
            true
            
        } catch (e: Exception) {
            Log.e(TAG, "Model initialization failed overall: ${e.message}", e)
            release()
            false
        }
    }
    
    /**
     * Load a file into a MappedByteBuffer and PIN the streams/channels to class members
     * to prevent premature native detachment (SIGSEGV).
     */
    private fun loadPinnedFile(file: File): MappedByteBuffer {
        val inputStream = FileInputStream(file)
        pinnedStreams.add(inputStream)
        val fileChannel = inputStream.channel
        pinnedChannels.add(fileChannel)
        return fileChannel.map(FileChannel.MapMode.READ_ONLY, 0, fileChannel.size())
    }
    
    /**
     * Log model input/output tensor info for debugging
     */
    private fun logModelInfo(name: String, interpreter: Interpreter) {
        val inputCount = interpreter.inputTensorCount
        val outputCount = interpreter.outputTensorCount
        
        Log.d(TAG, "=== $name model info ===")
        for (i in 0 until inputCount) {
            val tensor = interpreter.getInputTensor(i)
            Log.d(TAG, "  Input $i: name=${tensor.name()}, shape=${tensor.shape().contentToString()}, dtype=${tensor.dataType()}")
        }
        for (i in 0 until outputCount) {
            val tensor = interpreter.getOutputTensor(i)
            Log.d(TAG, "  Output $i: name=${tensor.name()}, shape=${tensor.shape().contentToString()}, dtype=${tensor.dataType()}")
        }
    }
    
    private fun checkFileExists(file: File) {
        if (!file.exists()) {
            throw java.io.FileNotFoundException("Model file not found: ${file.absolutePath}")
        }
        if (file.length() == 0L) {
            throw java.io.IOException("Model file is empty: ${file.absolutePath}")
        }
    }
    
    private fun tryLoadVadModel() {
        // Scan for common VAD model names (silero-vad-v4 is default in vad-capacitor)
        val potentialPaths = listOf(
            File(context.filesDir, "vad-models/silero-vad-v4.onnx"),
            File(context.filesDir, "vad-models/silero_vad.onnx"),
            File(context.filesDir, "models/vad/silero_vad.onnx"),
            File(context.filesDir, "wakeword-models/silero_vad.onnx")
        )

        for (file in potentialPaths) {
            if (file.exists()) {
                if (vad.loadModel(file)) {
                    isVadEnabled = true
                    Log.i(TAG, "Auto-loaded VAD model from ${file.absolutePath}")
                    return
                }
            }
        }
        
        // Debugging: List contents of vad-models if not found
        val vadDir = File(context.filesDir, "vad-models")
        if (vadDir.exists() && vadDir.isDirectory) {
            val files = vadDir.listFiles()
            val fileList = files?.joinToString { it.name } ?: "empty"
            Log.w(TAG, "VAD model not found. Contents of vad-models: $fileList")
        } else {
             Log.w(TAG, "VAD model not found. vad-models directory does not exist.")
        }
        
        Log.w(TAG, "VAD model detection failed. Will rely on RMS gating.")
    }

    /**
     * Warm up models with dummy inference to initialize internal state
     */
    private fun warmUp() {
        Log.d(TAG, "Warming up models (single-threaded)...")
        try {
            val dummyAudio = FloatArray(CHUNK_SAMPLES)
            repeat(EMBEDDING_WINDOW) {
                // For warmup, use same dummy array for both raw and amplified
                processAudio(dummyAudio, dummyAudio)
            }
            Log.d(TAG, "Warmup complete.")
        } catch (e: Exception) {
            Log.e(TAG, "Warmup failed: ${e.message}")
        }
        
        // Reset stats and buffer after warmup
        totalInferenceTime = 0
        inferenceCount = 0
        embeddingBuffer.clear()
        lastDetectionTime = 0
        
        // Capture silence embedding from the dummy audio (zeros)
        // This represents "absolute silence" in the model's embedding space
        try {
            // We just processed zeroes. The last embedding in the buffer (if any) or just run one more explicit zero input
            // Actually, processAudio adds to buffer. Let's run zeros explicitly one more time and capture result directly
            val zeroes = FloatArray(CHUNK_SAMPLES)
            computeMelSpectrogram(zeroes)
            silenceEmbedding = computeEmbeddings()
            Log.i(TAG, "Captured silence embedding reference")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to capture silence embedding", e)
        }
    }
    
    /**
     * Process an audio chunk and check for wake word
     * @param rawAudio - Normalized [-1,1] without gain, used for VAD
     * @param amplifiedAudio - Amplified and clipped audio, used for mel/embeddings
     */
    @Synchronized
    fun processAudio(rawAudio: FloatArray, amplifiedAudio: FloatArray): DetectionResult {
        if (!modelsLoaded) {
            return DetectionResult(false, 0f, "")
        }
        
        val startTime = System.nanoTime()
        
        try {
            // Step 0: VAD Check (Pre-filtering) - uses RAW audio for accurate detection
            // -----------------------------------------------------
            var isSpeech = true // Default to true if VAD missing
            if (isVadEnabled) {
                // 1. Append new RAW audio to VAD buffer (not amplified)
                val combined = FloatArray(vadBuffer.size + rawAudio.size)
                System.arraycopy(vadBuffer, 0, combined, 0, vadBuffer.size)
                System.arraycopy(rawAudio, 0, combined, vadBuffer.size, rawAudio.size)
                
                var offset = 0
                val windowSize = 512
                var maxProb = 0f
                var processedChunks = 0
                
                // 2. Process all complete 512-sample chunks
                while (offset + windowSize <= combined.size) {
                    val chunk = FloatArray(windowSize)
                    System.arraycopy(combined, offset, chunk, 0, windowSize)
                    
                    val prob = vad.processChunk(chunk)
                    maxProb = kotlin.math.max(maxProb, prob)
                    processedChunks++
                    
                    offset += windowSize
                }
                
                // 3. Save remainder
                if (offset < combined.size) {
                    val remaining = combined.size - offset
                    vadBuffer = FloatArray(remaining)
                    System.arraycopy(combined, offset, vadBuffer, 0, remaining)
                } else {
                    vadBuffer = FloatArray(0)
                }
                
                lastVadProb = maxProb
                
                // Decision: If NO chunk in this 80ms had speech, reject.
                // Threshold 0.5 is standard for Silero.
                if (processedChunks > 0 && maxProb < 0.5f) {
                    isSpeech = false
                }
                
                // State transition logging
                if (isSpeech != wasSpeech) {
                    if (debugMode) {
                        if (isSpeech) {
                             Log.d(TAG, "🗣️ VAD: Speech Started (Prob: $maxProb)")
                        } else {
                             Log.d(TAG, "🤫 VAD: Silence Detected (Prob: $maxProb)")
                        }
                    }
                    wasSpeech = isSpeech
                } else if (!isSpeech && maxProb > 0.01f && debugMode) {
                    // Verbose: Log "silent" frames that have some probability, to debug dead VAD
                    Log.d(TAG, "VAD Prob: $maxProb (Speech: false)")
                }
            }
            
            // If VAD says silence, we still want to update embedding buffer 
            // to keep temporal continuity? 
            // OR we skip entirely. If we skip, the buffer becomes stale or desynchronized?
            // "Silence" in embedding space is a valid input.
            // But to save CPU, we might skip MEL + Embedding.
            // HOWEVER, the wake word model (RNN/Time-series) expects a stream.
            // If we stop feeding it, it "pauses". When we resume, it sees [Last Speech] -> [New Speech] 
            // effectively deleting the silence gap. This is usually GOOD for wake words (skipping silence).
            
            // BYPASS VAD for custom models - Silero VAD not calibrated for this audio pipeline
            // For custom models, we rely on RMS threshold instead (in computeCustomScore)
            if (!isSpeech && isVadEnabled && !isCustomModel) {
                // VAD says silence (only for standard models)
                if (debugMode) {
                    Log.d(TAG, "🚫 VAD blocked: maxProb=${String.format("%.3f", lastVadProb)} < 0.5 (silence)")
                }
                // Return no detection.
                return DetectionResult(false, 0f, currentModelName)
            } else if (isCustomModel && debugMode && !isSpeech) {
                // Log.d(TAG, "⏩ VAD bypassed for custom model (maxProb=${String.format("%.3f", lastVadProb)})")
            }


            // Step 1: Audio → Mel Spectrogram (uses AMPLIFIED audio for better features)

            computeMelSpectrogram(amplifiedAudio)
            
            // Step 2: Mel → Embeddings (Uses melOutputArray as input)
            val embeddings = computeEmbeddings()
            
            // Add to sliding window buffer
            embeddingBuffer.addLast(embeddings)
            if (embeddingBuffer.size > bufferSize) {
                embeddingBuffer.removeFirst()
            }
            
            // Need enough context before detection
            // Needed only for standard models, but we keep the buffer updated for both
            if (embeddingBuffer.size < EMBEDDING_WINDOW) {
                return DetectionResult(false, 0f, currentModelName)
            }
            
            // RMS Calculation for VAD / Gating (use RAW audio for accurate RMS)
            val rms = calculateRMS(rawAudio)

            // If training, just accumulating embeddings
            if (isTraining) {
                // Accumulate audio for replay (use amplified for playback consistency)
                val pcmData = floatArrayToPCM16(amplifiedAudio)
                currentRecordingAudio.write(pcmData)

                // RMS Filter: Capture all valid frames with their RMS
                // We will filter dynamically at stopTraining
                if (rms > 0.001f) { // Basic noise floor sanity check
                    trainingSessionEmbeddings.add(Pair(embeddings, rms))
                }
                
                return DetectionResult(false, 0f, "training")
            }

            var confidence = 0f
            
            if (isCustomModel) {
                // Custom Template Matching with RMS Gating
                confidence = computeCustomScore(rms)
            } else {
                // Standard TFLite Model
                stackEmbeddings()
                confidence = computeWakeWordScore()
            }
            
            // Track performance
            val inferenceTime = (System.nanoTime() - startTime) / 1_000_000
            totalInferenceTime += inferenceTime
            inferenceCount++
            
            val now = System.currentTimeMillis()
            val passedCooldown = (now - lastDetectionTime) > cooldownMs
            
            // For custom models: require temporal consistency (N consecutive frames above threshold)
            // This dramatically reduces false positives from random speech
            val detected: Boolean
            if (isCustomModel) {
                if (confidence > threshold) {
                    consecutiveDetections++
                    if (debugMode && consecutiveDetections < minConsecutiveFrames) {
                        // Log.d(TAG, "📈 Consecutive: $consecutiveDetections/$minConsecutiveFrames (score: ${String.format("%.3f", confidence)})")
                    }
                    detected = consecutiveDetections >= minConsecutiveFrames && passedCooldown
                } else {
                    // Reset counter if score drops below threshold
                    if (consecutiveDetections > 0 && debugMode) {
                        Log.d(TAG, "📉 Consecutive reset (was $consecutiveDetections, score dropped to ${String.format("%.3f", confidence)})")
                    }
                    consecutiveDetections = 0
                    detected = false
                }
            } else {
                // Standard models don't need temporal consistency
                detected = confidence > threshold && passedCooldown
            }
            
            if (detected) {
                lastDetectionTime = now
                consecutiveDetections = 0  // Reset after detection
                Log.i(TAG, "🔔 Detection! Confidence: $confidence, Inference: ${inferenceTime}ms")
            } else if (debugMode && confidence > 0.1f && !isCustomModel) {
                // Log close calls to help debugging (only for standard models)
                Log.d(TAG, "Rejected: Confidence $confidence < Threshold $threshold (Mag: ${computeEmbeddingMagnitude(embeddings)})")
            }
            
            return DetectionResult(detected, confidence, currentModelName)
            
        } catch (e: Exception) {
            Log.e(TAG, "Processing error", e)
            return DetectionResult(false, 0f, currentModelName)
        }
    }
    
    /**
     * Compute Mel Spectrogram features from audio
     * Input: Audio samples [1, 1280]
     * Output: Puts result directly into melOutputArray [1, 1, 5, 32]
     */
    private fun computeMelSpectrogram(audio: FloatArray) {
        val interpreter = melInterpreter ?: throw IllegalStateException("Mel interpreter not loaded")
        
        val audioToUse = if (audio.size >= CHUNK_SAMPLES) {
            audio.sliceArray(0 until CHUNK_SAMPLES)
        } else {
            audio + FloatArray(CHUNK_SAMPLES - audio.size)
        }
        System.arraycopy(audioToUse, 0, melInputArray[0], 0, CHUNK_SAMPLES)
        
        try {
            // melOutputArray is Array(1){Array(1){Array(5){FloatArray(32)}}}
            interpreter.run(melInputArray, melOutputArray)
        } catch (e: Exception) {
            Log.e(TAG, "Mel inference failed via Shape-Perfect bridge: ${e.message}")
            throw e
        }
    }
    
    /**
     * Compute embeddings from mel features
     * Iteration 11: Diagnostic safety skip.
     */
    /**
     * Compute Embeddings from Mel features
     * Input: Last 76 frames of 32 features
     * Output: 96-dim embedding
     */
    private fun computeEmbeddings(): FloatArray {
        val interpreter = embeddingInterpreter ?: throw IllegalStateException("Embedding interpreter not loaded")

        // 1. Shift buffer logic: Shift by 5, append new 5 frames
        // melOutputArray is [1][1][5][32]
        
        // Shift buffer left by 5
        for (i in 0 until 91) {
             System.arraycopy(melFeaturesBuffer[i + 5], 0, melFeaturesBuffer[i], 0, 32)
        }
        // Insert new 5 frames at end
        for (j in 0 until 5) {
             System.arraycopy(melOutputArray[0][0][j], 0, melFeaturesBuffer[91 + j], 0, 32)
        }
        
        // 2. Prepare Input Buffer
        // We need the last 76 frames (indices 20 to 95)
        // Shape [1, 76, 32, 1] -> Flat float sequence of 76*32 floats
        embInputBuffer.rewind()
        for (i in 0 until 76) {
             val frame = melFeaturesBuffer[i + 20] // Size 32
             for (valF in frame) {
                 embInputBuffer.putFloat(valF)
             }
        }
        
        // 3. Run Inference
        try {
            embInputBuffer.rewind()
            embOutputBuffer.rewind()
            interpreter.run(embInputBuffer, embOutputBuffer)
        } catch (e: Exception) {
             Log.e(TAG, "Embedding inference failed: ${e.message}")
             return FloatArray(EMBEDDING_DIM) 
        }
        
        // 4. Extract Output
        // Shape [1, 1, 1, 96] -> 96 floats
        val result = FloatArray(EMBEDDING_DIM)
        embOutputBuffer.rewind()
        embOutputBuffer.asFloatBuffer().get(result)
        
        return result
    }
    
    private fun stackEmbeddings() {
        // wwInputArray is [1, 16, 96]
        // Copy from deque to array
        for (i in 0 until EMBEDDING_WINDOW) {
            // deque iterator order is start to end (oldest to newest)
            // or we optimize by index if deque supports it efficiently
            // Java ArrayDeque doesn't support random access via index easily without conversion
            // But we can iterate.
        }
        
        val iterator = embeddingBuffer.iterator()
        var idx = 0
        while (iterator.hasNext() && idx < EMBEDDING_WINDOW) {
            val emb = iterator.next()
            System.arraycopy(emb, 0, wwInputArray[0][idx], 0, EMBEDDING_DIM)
            idx++
        }
    }
    
    /**
     * Compute wake word score (Stub for Iteration 11)
     */
    private fun computeWakeWordScore(): Float {
        val interpreter = wakeWordInterpreter ?: return 0f
        
        try {
             interpreter.run(wwInputArray, wwOutputArray)
             return wwOutputArray[0][0]
        } catch (e: Exception) {
             Log.e(TAG, "Wake word inference failed: ${e.message}")
             return 0f
        }
    }
    
    /**
     * Compute cosine similarity against custom template
     * Includes robustness checks: embedding magnitude validation and rejection threshold.
     */
    private fun computeCustomScore(rms: Float): Float {
        val template = customTemplates[currentModelName] ?: run {
            if (debugMode) Log.w(TAG, "🚫 No template found for: $currentModelName")
            return 0f
        }
        
        // Get the most recent embedding
        val currentEmbedding = embeddingBuffer.last()
        
        // Store for debug diagnostics
        lastDebugEmbedding = currentEmbedding.copyOf()
        lastDebugRms = rms
        lastDebugChunkSize = CHUNK_SAMPLES
        
        // Log entry to this function
        if (debugMode) {
            // Log.d(TAG, "📊 computeCustomScore called: RMS=${String.format("%.5f", rms)}, threshold=$TRAIN_RMS_THRESHOLD")
        }
        
        // Robustness Check 1: Validate RMS (Silence Rejection - VAD)
        if (rms < TRAIN_RMS_THRESHOLD) {
            // Silence detected. Even if embedding is similar (due to normalization), reject it.
            // Excessive logging removed to save resources
            // if (debugMode) Log.d(TAG, "🔇 RMS too low: ${String.format("%.5f", rms)} < $TRAIN_RMS_THRESHOLD (silence)")
            lastDebugSimilarity = 0f
            return 0f
        }

        // Robustness Check 2: Validate embedding magnitude (legacy check, often high anyway)
        val magnitude = computeEmbeddingMagnitude(currentEmbedding)
        if (magnitude < MIN_EMBEDDING_MAGNITUDE) {
            if (debugMode) {
                Log.d(TAG, "Embedding rejected: magnitude $magnitude < $MIN_EMBEDDING_MAGNITUDE")
            }
            lastDebugSimilarity = 0f
            return 0f // Definitely not a match
        }
        
        val score = cosineSimilarity(currentEmbedding, template)
        lastDebugSimilarity = score
        
        // DEBUG: Log detailed comparison ALWAYS (removed score threshold to debug low similarity issues)
        if (false) { // Disabled verbose logging to clear logcat
            val templateMag = computeEmbeddingMagnitude(template)
            val liveFirst10 = currentEmbedding.take(10).map { String.format("%.3f", it) }
            val templateFirst10 = template.take(10).map { String.format("%.3f", it) }
            
            // Log.i(TAG, "🎤 LIVE vs TEMPLATE Comparison:")
            // Log.i(TAG, "   Live Mag: ${String.format("%.3f", magnitude)} | Template Mag: ${String.format("%.3f", templateMag)}")
            // Log.i(TAG, "   Similarity: ${String.format("%.4f", score)} | Threshold: $threshold | RMS: ${String.format("%.5f", rms)}")
            // Log.i(TAG, "   Verdict: ${if (score > threshold) "MATCH ✅" else "NO MATCH ❌ (need ${String.format("%.2f", threshold - score)} more)"}")
        }
        
        // Robustness Check 3: Rejection threshold (definitely NOT a match)
        if (score < REJECTION_THRESHOLD) {
            if (debugMode) {
                Log.d(TAG, "Score below rejection threshold: $score < $REJECTION_THRESHOLD")
            }
            return 0f // Return 0 to prevent any possible false positive
        }
        
        return score
    }

    private fun cosineSimilarity(vecA: FloatArray, vecB: FloatArray): Float {
        var dotProduct = 0.0f
        var normA = 0.0f
        var normB = 0.0f
        for (i in vecA.indices) {
            dotProduct += vecA[i] * vecB[i]
            normA += vecA[i] * vecA[i]
            normB += vecB[i] * vecB[i]
        }
        return if (normA > 0 && normB > 0) {
            dotProduct / (kotlin.math.sqrt(normA) * kotlin.math.sqrt(normB))
        } else {
            0.0f
        }
    }

    private fun calculateRMS(audio: FloatArray): Float {
        var sum = 0.0f
        for (sample in audio) {
            sum += sample * sample
        }
        return kotlin.math.sqrt(sum / audio.size)
    }

    // --- Training API ---

    fun startTraining() {
        isTraining = true
        // Do NOT clear trainingSamples here. We want to accumulate them over multiple sessions.
        // trainingSamples.clear() 
        trainingSessionEmbeddings.clear()
        currentRecordingAudio.reset()
        Log.i(TAG, "Started training mode")
    }

    fun stopTraining() {
        isTraining = false
        
        // Dynamic Thresholding Strategy
        // 1. Find the peak RMS in the session
        val maxRms = trainingSessionEmbeddings.maxOfOrNull { it.second } ?: 0f
        
        // 2. Define effective threshold (e.g., 30% of peak, but at least 0.005)
        val dynamicThreshold = (maxRms * 0.3f).coerceAtLeast(0.005f)
        Log.i(TAG, "Training session stats: Count=${trainingSessionEmbeddings.size}, MaxRMS=$maxRms, Threshold=$dynamicThreshold")
        
        // 3. Filter candidates
        val candidates = trainingSessionEmbeddings
            .filter { it.second >= dynamicThreshold }
            .map { it.first }
            
        // 4. Select best
        val bestEmbedding = selectBestEmbedding(candidates)
        
        if (bestEmbedding != null) {
            trainingSamples.add(bestEmbedding)
            Log.i(TAG, "Captured training sample. Total samples: ${trainingSamples.size}")
        } else {
            Log.w(TAG, "No valid embedding captured (Session too quiet?)")
        }
        
        trainingSessionEmbeddings.clear()
        Log.i(TAG, "Stopped training mode.")
    }
    
    private fun selectBestEmbedding(candidates: List<FloatArray>): FloatArray? {
        if (candidates.isEmpty()) return null
        if (silenceEmbedding == null) return candidates.last() // Fallback
        
        // Find the candidate with minimum similarity to silence (i.e., most distinct sound)
        // We only consider the middle chunk of the recording to avoid start/end clicks? 
        // No, simple distance to silence is best.
        
        var minSim = 2.0f // Cosine sim is -1 to 1
        var bestCandidate: FloatArray? = null
        
        for (cand in candidates) {
            val sim = cosineSimilarity(cand, silenceEmbedding!!)
            if (sim < minSim) {
                minSim = sim
                bestCandidate = cand
            }
        }
        
        Log.d(TAG, "Selected training sample with silence similarity: $minSim")
        
        // Safety: If even the best sample is too close to silence, maybe reject it?
        // For now, just take it.
        return bestCandidate
    }
    
    private fun verifyModelSanity(modelName: String): Boolean {
        if (silenceEmbedding == null) return true // Cannot verify
        val template = customTemplates["custom:$modelName"] ?: return true
        
        val sim = cosineSimilarity(template, silenceEmbedding!!)
        Log.d(TAG, "Sanity check '$modelName': Silence similarity = $sim")
        
        // If similarity is very high (e.g. > 0.9), this model IS silence
        return sim < 0.9f
    }

    fun clearTrainingData() {
        trainingSamples.clear()
        currentRecordingAudio.reset()
        Log.i(TAG, "Cleared training data")
    }

    fun getTrainingAudio(): String {
        return android.util.Base64.encodeToString(currentRecordingAudio.toByteArray(), android.util.Base64.NO_WRAP)
    }

    /**
     * Ingest a training sample from external audio (JS HighQualityAudioRecorder).
     * @param base64Pcm Base64-encoded 16-bit signed little-endian PCM at 16kHz mono.
     * @return true if the sample was successfully processed and contains valid speech
     */
    @Synchronized
    fun ingestTrainingSample(base64Pcm: String): Boolean {
        if (!modelsLoaded) {
            Log.e(TAG, "Cannot ingest sample: models not loaded")
            return false
        }
        
        try {
            // Decode Base64 to bytes
            val pcmBytes = android.util.Base64.decode(base64Pcm, android.util.Base64.DEFAULT)
            
            // Convert PCM16 bytes to FloatArray
            val numSamples = pcmBytes.size / 2
            val floatAudio = FloatArray(numSamples)
            val byteBuffer = java.nio.ByteBuffer.wrap(pcmBytes).order(java.nio.ByteOrder.LITTLE_ENDIAN)
            
            for (i in 0 until numSamples) {
                floatAudio[i] = byteBuffer.getShort().toFloat() / 32768.0f
            }
            
            Log.i(TAG, "Ingesting external sample: $numSamples samples (${numSamples / 16000.0}s)")
            
            // Process audio in chunks and collect embeddings with RMS
            val chunkEmbeddings = mutableListOf<Pair<FloatArray, Float>>()
            var offset = 0
            
            while (offset + CHUNK_SAMPLES <= floatAudio.size) {
                val chunk = floatAudio.copyOfRange(offset, offset + CHUNK_SAMPLES)
                val rms = calculateRMS(chunk)
                
                // Process through mel spectrogram
                computeMelSpectrogram(chunk)
                
                // Get embedding
                val embedding = computeEmbeddings()
                
                // Only keep if RMS is above threshold (speech)
                if (rms > TRAIN_RMS_THRESHOLD) {
                    val magnitude = computeEmbeddingMagnitude(embedding)
                    // Relaxed threshold from 0.5 to 0.1 to avoid rejecting valid speech
                    if (magnitude >= MIN_EMBEDDING_MAGNITUDE) { 
                        chunkEmbeddings.add(Pair(embedding.copyOf(), rms))
                         Log.d(TAG, "Chunk accepted: RMS=$rms, Mag=$magnitude")
                    } else {
                        Log.w(TAG, "Chunk rejected: magnitude $magnitude < $MIN_EMBEDDING_MAGNITUDE (RMS=$rms)")
                    }
                }
                
                offset += CHUNK_SAMPLES
            }
            
            if (chunkEmbeddings.isEmpty()) {
                Log.w(TAG, "No valid speech chunks found in sample")
                return false
            }
            
            // Select the best embedding using existing logic
            val candidates = chunkEmbeddings.map { it.first }
            val bestEmbedding = selectBestEmbedding(candidates)
            
            if (bestEmbedding != null) {
                trainingSamples.add(bestEmbedding)
                
                // DEBUG: Log enrollment embedding properties
                val magnitude = computeEmbeddingMagnitude(bestEmbedding)
                val first10 = bestEmbedding.take(10).map { String.format("%.4f", it) }
                Log.i(TAG, "📝 ENROLLMENT Embedding captured:")
                Log.i(TAG, "   Magnitude: $magnitude")
                Log.i(TAG, "   Dimension: ${bestEmbedding.size}")
                Log.i(TAG, "   First 10 values: $first10")
                Log.i(TAG, "   Total samples so far: ${trainingSamples.size}")
                
                return true
            } else {
                Log.w(TAG, "Could not select best embedding from sample")
                return false
            }
            
        } catch (e: Exception) {
            Log.e(TAG, "Failed to ingest training sample", e)
            return false
        }
    }
    
    /**
     * Compute L2 magnitude of an embedding vector.
     * L2-normalized embeddings should have magnitude ≈ 1.0
     */
    private fun computeEmbeddingMagnitude(embedding: FloatArray): Float {
        var sum = 0.0f
        for (v in embedding) {
            sum += v * v
        }
        return kotlin.math.sqrt(sum)
    }

    private fun floatArrayToPCM16(floats: FloatArray): ByteArray {
        val buffer = ByteArray(floats.size * 2)
        for (i in floats.indices) {
            val s = (floats[i].coerceIn(-1.0f, 1.0f) * 32767).toInt().toShort()
            buffer[i * 2] = (s.toInt() and 0x00FF).toByte()
            buffer[i * 2 + 1] = ((s.toInt() shr 8) and 0x00FF).toByte()
        }
        return buffer
    }

    /**
     * Get the current embedding (for training collection)
     */
    fun getCurrentEmbedding(): FloatArray? {
        return if (embeddingBuffer.isNotEmpty()) embeddingBuffer.last() else null
    }
    
    /**
     * Add a sample embedding to the training set
     */
    fun addTrainingSample(embedding: FloatArray) {
        trainingSamples.add(embedding)
    }
    
    /**
     * Finalize training and save profile
     */
    fun saveCustomWakeWord(name: String): Boolean {
        if (trainingSamples.isEmpty()) return false
        
        // Average the samples to create a centroid template
        val dim = trainingSamples[0].size
        val template = FloatArray(dim)
        
        for (sample in trainingSamples) {
            for (i in 0 until dim) {
                template[i] += sample[i]
            }
        }
        
        for (i in 0 until dim) {
            template[i] /= trainingSamples.size.toFloat()
        }
        
        // DEBUG: Log template properties after averaging
        val templateMagnitude = computeEmbeddingMagnitude(template)
        val first10 = template.take(10).map { String.format("%.4f", it) }
        Log.i(TAG, "📋 TEMPLATE Created from ${trainingSamples.size} samples:")
        Log.i(TAG, "   Magnitude: $templateMagnitude")
        Log.i(TAG, "   Dimension: ${template.size}")
        Log.i(TAG, "   First 10 values: $first10")
        
        // Save to file
        return try {
            val profilesDir = File(context.filesDir, "custom_wakewords")
            if (!profilesDir.exists()) profilesDir.mkdirs()
            
            val file = File(profilesDir, "$name.json")
            // Simple JSON serialization manually to avoid heavy deps if possible, or use standard ObjectOutputStream
            // Using a simple text format: comma separated floats
            file.writeText(template.joinToString(","))
            
            customTemplates["custom:$name"] = template
            Log.i(TAG, "✅ Saved custom profile: $name")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to save profile", e)
            false
        }
    }
    
    private fun loadProfile(name: String): Boolean {
        return try {
            val profilesDir = File(context.filesDir, "custom_wakewords")
            val file = File(profilesDir, "$name.json")
            
            if (!file.exists()) return false
            
            val content = file.readText()
            val template = content.split(",").map { it.toFloat() }.toFloatArray()
            
            customTemplates["custom:$name"] = template
            Log.i(TAG, "Loaded custom profile: $name")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load profile", e)
            false
        }
    }
    
    // Configuration setters
    fun setThreshold(value: Float) {
        threshold = value.coerceIn(0f, 1f)
    }
    
    fun setCooldownMs(value: Long) {
        cooldownMs = value.coerceAtLeast(0)
    }
    
    fun setBufferSize(value: Int) {
        bufferSize = value.coerceIn(8, 64)
    }
    
    fun setDebugMode(enabled: Boolean) {
        debugMode = enabled
    }
    
    /**
     * Check if models are loaded
     */
    fun isLoaded(): Boolean = modelsLoaded
    
    /**
     * Get average inference time in milliseconds
     */
    fun getAverageInferenceTime(): Double {
        return if (inferenceCount > 0) {
            totalInferenceTime.toDouble() / inferenceCount
        } else {
            0.0
        }
    }
    
    /**
     * Release all resources
     */
    fun release() {
        melInterpreter?.close()
        embeddingInterpreter?.close()
        wakeWordInterpreter?.close()
        
        melInterpreter = null
        embeddingInterpreter = null
        wakeWordInterpreter = null
        
        melModelBuffer = null
        embeddingModelBuffer = null
        wakeWordModelBuffer = null
        
        pinnedStreams.forEach { try { it.close() } catch (e: Exception) {} }
        pinnedChannels.forEach { try { it.close() } catch (e: Exception) {} }
        pinnedStreams.clear()
        pinnedChannels.clear()
        
        embeddingBuffer.clear()
        modelsLoaded = false
        Log.i(TAG, "Resources released")
    }
    
    /**
     * Get debug diagnostics for analyzing wake word detection accuracy.
     * Returns null if no custom model is loaded or no diagnostics available.
     */
    fun getDebugDiagnostics(): DebugDiagnosticResult? {
        val debugMsg = StringBuilder()
        debugMsg.append("Model: '$currentModelName', Custom: $isCustomModel. ")
        debugMsg.append("Keys: ${customTemplates.keys}. ")
        
        if (!isCustomModel) {
            Log.w(TAG, "getDebugDiagnostics: Not a custom model")
            return null
        }
        
        val template = customTemplates[currentModelName]
        if (template == null) {
            debugMsg.append("❌ Template NOT found!")
            return DebugDiagnosticResult(
                templateMagnitude = 0f,
                templateDimension = 0,
                templateFirst10 = FloatArray(10),
                lastEmbeddingMagnitude = 0f,
                lastEmbeddingFirst10 = FloatArray(10),
                lastChunkSize = 0,
                lastRms = 0f,
                lastSimilarity = 0f,
                currentThreshold = threshold,
                vadProbability = 0f,
                bufferSize = 0,
                isMatch = false,
                enrollmentSampleCount = 0,
                consecutiveDetections = 0,
                minConsecutiveFrames = 0,
                debugInfo = debugMsg.toString()
            )
        }
        
        // Allow partial diagnostics even if no embedding (e.g., VAD blocked)
        val lastEmb = lastDebugEmbedding
        val templateMag = computeEmbeddingMagnitude(template)
        val embMag = if (lastEmb != null) computeEmbeddingMagnitude(lastEmb) else 0f
        val embFirst10 = if (lastEmb != null) lastEmb.take(10).toFloatArray() else FloatArray(10)
        
        debugMsg.append("Emb: ${if(lastEmb!=null) "OK" else "NULL"}. ")
        
        return DebugDiagnosticResult(
            templateMagnitude = templateMag,
            templateDimension = template.size,
            templateFirst10 = template.take(10).toFloatArray(),
            lastEmbeddingMagnitude = embMag,
            lastEmbeddingFirst10 = embFirst10,
            lastChunkSize = lastDebugChunkSize,
            lastRms = lastDebugRms,
            lastSimilarity = lastDebugSimilarity,
            currentThreshold = threshold,
            vadProbability = lastVadProb,
            bufferSize = embeddingBuffer.size,
            isMatch = lastDebugSimilarity > threshold,
            enrollmentSampleCount = trainingSamples.size,
            consecutiveDetections = consecutiveDetections,
            minConsecutiveFrames = minConsecutiveFrames,
            debugInfo = debugMsg.toString()
        )
    }
}