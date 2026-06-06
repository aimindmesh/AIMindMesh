package com.aimindmesh.wakeword

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.util.Log
import kotlin.math.abs
import kotlin.math.sqrt

/**
 * Audio processor for continuous microphone capture.
 * Captures 16kHz mono PCM audio in 80ms chunks for wake word detection.
 * Provides both raw normalized audio (for VAD) and amplified audio (for mel/embeddings).
 */
class AudioProcessor(
    // Callback receives (rawAudio for VAD, amplifiedAudio for embeddings)
    private val onAudioChunk: (rawAudio: FloatArray, amplifiedAudio: FloatArray) -> Unit,
    private val onAudioLevel: ((Float) -> Unit)? = null,
    private val onError: (String) -> Unit
) {
    companion object {
        private const val TAG = "AudioProcessor"
        
        // Audio configuration (OpenWakeWord standard)
        const val SAMPLE_RATE = 16000
        const val CHUNK_SAMPLES = 1280  // 80ms @ 16kHz
        
        private const val CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO
        private const val AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT
        
        // Audio level update interval (every N chunks)
        private const val LEVEL_UPDATE_INTERVAL = 5
        
        // Software gain to boost quiet signals for mel/embedding processing
        private const val SOFTWARE_GAIN = 10.0f
    }
    
    private var audioRecord: AudioRecord? = null
    private var recordingThread: Thread? = null
    
    @Volatile
    private var _isRecording = false
    
    /**
     * Check if currently recording
     */
    val isRecording: Boolean
        get() = _isRecording
    
    private var chunkCount = 0
    
    /**
     * Start audio capture
     */
    fun start() {
        if (_isRecording) {
            Log.w(TAG, "Already recording")
            return
        }
        
        try {
            val minBufferSize = AudioRecord.getMinBufferSize(
                SAMPLE_RATE,
                CHANNEL_CONFIG,
                AUDIO_FORMAT
            )
            
            // Use larger buffer to prevent overflow
            val bufferSize = maxOf(minBufferSize * 2, CHUNK_SAMPLES * 4)
            
            // ALIGNMENT WITH VOSK: Use UNPROCESSED (Source 9) on API 24+
            val audioSource = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                MediaRecorder.AudioSource.UNPROCESSED
            } else {
                MediaRecorder.AudioSource.VOICE_RECOGNITION
            }
            
            Log.d(TAG, "Initializing AudioRecord: Source=${getSourceName(audioSource)}, Rate=$SAMPLE_RATE, Buffer=$bufferSize")

            audioRecord = AudioRecord(
                audioSource,
                SAMPLE_RATE,
                CHANNEL_CONFIG,
                AUDIO_FORMAT,
                bufferSize
            )
            
            if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
                onError("Failed to initialize AudioRecord")
                audioRecord?.release()
                audioRecord = null
                return
            }
            
            audioRecord?.startRecording()
            if (audioRecord?.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
                onError("Failed to start recording")
                audioRecord?.release()
                audioRecord = null
                return
            }

            _isRecording = true
            chunkCount = 0
            
            Log.i(TAG, "Audio capture started successfully")

            // Start processing loop in a dedicated thread
            recordingThread = Thread({
                processAudioLoop()
            }, "WakeWordAudioThread").apply {
                priority = Thread.MAX_PRIORITY
                start()
            }
            
        } catch (e: SecurityException) {
            onError("Microphone permission denied: ${e.message}")
        } catch (e: Exception) {
            onError("Failed to start audio capture: ${e.message}")
        }
    }
    
    /**
     * Main audio processing loop runs in background thread
     */
    private fun processAudioLoop() {
        val shortBuffer = ShortArray(CHUNK_SAMPLES)
        val rawBuffer = FloatArray(CHUNK_SAMPLES)       // For VAD: raw normalized [-1, 1]
        val amplifiedBuffer = FloatArray(CHUNK_SAMPLES) // For embeddings: amplified & clipped
        
        Log.d(TAG, "Audio processing loop started")
        
        try {
            while (_isRecording) {
                val record = audioRecord ?: break
                val readResult = record.read(shortBuffer, 0, CHUNK_SAMPLES)
                
                if (readResult > 0) {
                    var sumSquaresRaw = 0.0
                    var maxRaw = 0
                    
                    for (i in 0 until readResult) {
                        val raw = shortBuffer[i].toInt()
                        val absRaw = abs(raw)
                        if (absRaw > maxRaw) maxRaw = absRaw
                        
                        // Raw normalized [-1, 1] - for VAD (no gain, no clipping distortion)
                        val normalized = raw / 32768.0f
                        rawBuffer[i] = normalized
                        
                        // Amplified and clipped - for mel/embeddings
                        val amplified = normalized * SOFTWARE_GAIN
                        amplifiedBuffer[i] = amplified.coerceIn(-1.0f, 1.0f)
                        
                        sumSquaresRaw += normalized * normalized
                    }
                    
                    val rmsRaw = sqrt(sumSquaresRaw / readResult).toFloat()
                    chunkCount++
                    
                    // Periodic signal diagnostics
                    if (chunkCount % (LEVEL_UPDATE_INTERVAL * 20) == 0) {
                        Log.d(TAG, "Signal [${getSourceName(record.audioSource)}]: RMS_raw=${String.format("%.5f", rmsRaw)}, MaxRaw=$maxRaw")
                    }

                    // Audio level for UI (based on raw audio)
                    if (chunkCount % LEVEL_UPDATE_INTERVAL == 0) {
                        val level = (rmsRaw * 50f).coerceIn(0f, 1f) // Scale for UI visibility
                        onAudioLevel?.invoke(level)
                    }
                    
                    // Pass both raw and amplified audio to detector
                    onAudioChunk(rawBuffer.copyOf(readResult), amplifiedBuffer.copyOf(readResult))
                } else if (readResult < 0) {
                    Log.e(TAG, "AudioRecord read error: $readResult")
                    break
                }
            }
        } catch (e: Exception) {
            if (_isRecording) {
                Log.e(TAG, "Error in processAudioLoop", e)
                onError("Audio loop error: ${e.message}")
            }
        } finally {
            Log.d(TAG, "Audio processing loop ended")
        }
    }
    
    /**
     * Stop audio capture and release resources
     */
    fun stop() {
        if (!_isRecording) return
        
        Log.d(TAG, "Stopping audio capture...")
        _isRecording = false
        
        recordingThread?.let { thread ->
            try {
                thread.join(1000)
                if (thread.isAlive) {
                    Log.w(TAG, "Thread join timeout, interrupting")
                    thread.interrupt()
                }
            } catch (e: InterruptedException) {
                Log.e(TAG, "Interrupted stopping thread", e)
            }
            // Ensure lambda returns Unit to avoid 'if as expression' issues
            Unit
        }
        recordingThread = null
        
        audioRecord?.let { record ->
            try {
                if (record.state == AudioRecord.STATE_INITIALIZED) {
                    record.stop()
                }
                record.release()
            } catch (e: Exception) {
                Log.e(TAG, "Error releasing AudioRecord", e)
            }
            Unit
        }
        audioRecord = null
        
        Log.i(TAG, "Audio capture stopped")
    }
    
    private fun getSourceName(source: Int): String {
        return when (source) {
            MediaRecorder.AudioSource.MIC -> "MIC"
            MediaRecorder.AudioSource.VOICE_RECOGNITION -> "VOICE_RECOGNITION"
            MediaRecorder.AudioSource.UNPROCESSED -> "UNPROCESSED"
            MediaRecorder.AudioSource.VOICE_COMMUNICATION -> "VOICE_COMMUNICATION"
            MediaRecorder.AudioSource.DEFAULT -> "DEFAULT"
            else -> "SOURCE($source)"
        }
    }
}