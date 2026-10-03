package com.aimindmesh.mobile.voxtral

import android.util.Log
import java.util.concurrent.BlockingQueue
import java.util.concurrent.LinkedBlockingQueue

/**
 * Voxtral Inference Engine - JNI wrapper for Voxtral STT
 * 
 * Uses the mtmd (multimodal) API from llama.cpp to handle the complete pipeline:
 * PCM audio → mel spectrogram → CLIP encoding → llama decode → text tokens.
 */
class VoxtralInferenceEngine {
    // Every native call holds this lock: release() can never free the context under a running chunk
    private val lock = Any()
    @Volatile
    private var nativeHandle: Long = 0
    private val tokenQueue: BlockingQueue<String> = LinkedBlockingQueue()
    @Volatile
    private var isRunning = false

    companion object {
        private const val TAG = "VoxtralEngine"

        // Error codes matching native voxtral_jni.cpp
        const val VOXTRAL_OK = 0
        const val VOXTRAL_ERR_NULL_HANDLE = -1
        const val VOXTRAL_ERR_INIT_FAILED = -2
        const val VOXTRAL_ERR_AUDIO_FAILED = -3
        const val VOXTRAL_ERR_ENCODE_FAILED = -4
        const val VOXTRAL_ERR_DECODE_FAILED = -5
        const val VOXTRAL_ERR_SAMPLE_FAILED = -6
        const val VOXTRAL_ERR_OOM = -7
        const val VOXTRAL_ERR_BUFFERING = 1  // Positive = still buffering

        init {
            try {
                System.loadLibrary("voxtral_jni")
                Log.d(TAG, "Voxtral JNI library loaded successfully")
            } catch (e: UnsatisfiedLinkError) {
                Log.e(TAG, "Failed to load voxtral_jni library", e)
            }
        }

        fun errorCodeToString(code: Int): String = when (code) {
            VOXTRAL_OK -> "OK"
            VOXTRAL_ERR_NULL_HANDLE -> "Null handle (model not loaded)"
            VOXTRAL_ERR_INIT_FAILED -> "Model initialization failed"
            VOXTRAL_ERR_AUDIO_FAILED -> "Audio preprocessing failed"
            VOXTRAL_ERR_ENCODE_FAILED -> "Audio encoding failed"
            VOXTRAL_ERR_DECODE_FAILED -> "Decoder failed"
            VOXTRAL_ERR_SAMPLE_FAILED -> "Token sampling failed"
            VOXTRAL_ERR_OOM -> "Out of memory"
            VOXTRAL_ERR_BUFFERING -> "Buffering audio..."
            else -> if (code > 0) "Generated $code tokens" else "Unknown error ($code)"
        }
    }



    // Native methods
    private external fun nativeInitModel(
        modelPath: String,
        mmprojPath: String,
        nThreads: Int
    ): Long

    private external fun nativeProcessAudio(
        handle: Long,
        audioSamples: FloatArray,
        nSamples: Int
    ): Int

    private external fun nativeGetToken(handle: Long): String?

    private external fun nativeResetContext(handle: Long)

    private external fun nativeIsModelLoaded(handle: Long): Boolean

    private external fun nativeReleaseModel(handle: Long)

    /**
     * Initialize the Voxtral model
     * 
     * @param modelPath Path to the main GGUF model file
     * @param mmprojPath Path to the audio encoder projector file
     * @param nThreads Number of threads for inference (default: 4)
     * @return true if initialization succeeded
     */
    fun initModel(
        modelPath: String,
        mmprojPath: String,
        nThreads: Int = 4
    ): Boolean = synchronized(lock) {
        if (nativeHandle != 0L) {
            Log.w(TAG, "Model already initialized, releasing previous instance")
            release()
        }

        Log.d(TAG, "Initializing Voxtral model: $modelPath")
        Log.d(TAG, "Audio encoder projector: $mmprojPath")

        nativeHandle = nativeInitModel(modelPath, mmprojPath, nThreads)

        if (nativeHandle == 0L) {
            Log.e(TAG, "Failed to initialize model")
            return@synchronized false
        }

        isRunning = true
        Log.i(TAG, "Model initialized successfully (handle: $nativeHandle)")
        true
    }

    /**
     * Process an audio chunk
     * 
     * @param audioData Float array of PCM audio samples (16kHz mono)
     * @return Number of tokens generated, or -1 on error
     */
    fun processAudioChunk(audioData: FloatArray): Int = synchronized(lock) {
        if (nativeHandle == 0L) {
            Log.e(TAG, "Cannot process audio: model not initialized")
            return@synchronized VOXTRAL_ERR_NULL_HANDLE
        }

        if (!isRunning) {
            Log.w(TAG, "Engine is not running")
            return@synchronized VOXTRAL_OK
        }

        try {
            val result = nativeProcessAudio(nativeHandle, audioData, audioData.size)

            when {
                result < 0 -> {
                    Log.e(TAG, "Audio processing error: ${errorCodeToString(result)}")
                }
                result == VOXTRAL_ERR_BUFFERING -> {
                    Log.v(TAG, "Buffering audio (${audioData.size} samples)")
                }
                result > 0 -> {
                    Log.d(TAG, "Generated $result tokens from audio chunk")
                }
            }
            result
        } catch (e: Exception) {
            Log.e(TAG, "Native crash during audio processing", e)
            VOXTRAL_ERR_DECODE_FAILED
        }
    }

    /**
     * Poll for the next available token (non-blocking)
     * 
     * @return Token string, or null if queue is empty
     */
    fun pollToken(): String? = synchronized(lock) {
        if (nativeHandle == 0L) null else nativeGetToken(nativeHandle)
    }

    /**
     * Get all available tokens from the queue
     * 
     * @return List of token strings
     */
    fun drainTokens(): List<String> {
        val tokens = mutableListOf<String>()
        var token = pollToken()
        while (token != null) {
            tokens.add(token)
            token = pollToken()
        }
        return tokens
    }

    /**
     * Reset the context (KV cache, audio buffer, token queue)
     * Useful between transcription sessions.
     */
    fun resetContext() = synchronized(lock) {
        if (nativeHandle != 0L) {
            Log.d(TAG, "Resetting Voxtral context")
            nativeResetContext(nativeHandle)
        }
    }

    /**
     * Check if the native model is loaded and ready
     */
    fun isModelLoaded(): Boolean {
        // nativeInitModel only returns a handle once model, context and mtmd are all loaded;
        // no lock here so status checks never wait for a chunk being transcribed
        return nativeHandle != 0L
    }

    /**
     * Release native resources
     */
    fun release() = synchronized(lock) {
        if (nativeHandle != 0L) {
            Log.d(TAG, "Releasing Voxtral model (handle: $nativeHandle)")
            isRunning = false
            try {
                nativeReleaseModel(nativeHandle)
            } catch (e: Exception) {
                Log.e(TAG, "Error during native release", e)
            }
            nativeHandle = 0
            tokenQueue.clear()
        }
    }

    /**
     * Check if the engine is initialized and running
     */
    fun isInitialized(): Boolean = nativeHandle != 0L && isRunning
}
