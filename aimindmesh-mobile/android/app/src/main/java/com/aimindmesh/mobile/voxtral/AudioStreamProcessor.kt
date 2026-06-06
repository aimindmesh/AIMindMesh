package com.aimindmesh.mobile.voxtral

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log
import kotlinx.coroutines.*
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Captures microphone audio and provides it as PCM chunks
 */
class AudioStreamProcessor(
    private val sampleRate: Int = 16000,
    private val channels: Int = 1
) {

    private var audioRecord: AudioRecord? = null
    private var recordingJob: Job? = null
    private var isRecording = false

    companion object {
        private const val TAG = "AudioStreamProcessor"
        private const val BUFFER_SIZE_FACTOR = 2
    }

    /**
     * Start capturing audio
     * @param onChunk: Callback with audio data (normalized float array)
     */
    fun startCapture(onChunk: (FloatArray) -> Unit) {
        val channelConfig = if (channels == 1) {
            AudioFormat.CHANNEL_IN_MONO
        } else {
            AudioFormat.CHANNEL_IN_STEREO
        }

        val bufferSize = AudioRecord.getMinBufferSize(
            sampleRate,
            channelConfig,
            AudioFormat.ENCODING_PCM_16BIT
        ) * BUFFER_SIZE_FACTOR

        try {
            audioRecord = AudioRecord(
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                sampleRate,
                channelConfig,
                AudioFormat.ENCODING_PCM_16BIT,
                bufferSize
            )

            if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
                Log.e(TAG, "AudioRecord not initialized")
                return
            }

            audioRecord?.startRecording()
            isRecording = true

            // Start reading audio in background
            recordingJob = CoroutineScope(Dispatchers.IO).launch {
                val buffer = ByteArray(bufferSize)

                while (isRecording) {
                    val bytesRead = audioRecord?.read(buffer, 0, buffer.size) ?: -1

                    if (bytesRead > 0) {
                        // Convert PCM16 to float32 normalized [-1.0, 1.0]
                        val floatData = pcm16ToFloat32(buffer, bytesRead)

                        // Send to callback
                        onChunk(floatData)
                    }
                }
            }

            Log.i(TAG, "Audio capture started")

        } catch (e: SecurityException) {
            Log.e(TAG, "Microphone permission denied", e)
        } catch (e: Exception) {
            Log.e(TAG, "Audio capture failed", e)
        }
    }

    /**
     * Stop capturing audio
     */
    fun stopCapture() {
        isRecording = false
        recordingJob?.cancel()
        recordingJob = null

        audioRecord?.stop()
        audioRecord?.release()
        audioRecord = null

        Log.i(TAG, "Audio capture stopped")
    }

    /**
     * Convert PCM16 byte array to float32 normalized array
     */
    private fun pcm16ToFloat32(bytes: ByteArray, length: Int): FloatArray {
        val shorts = length / 2
        val floats = FloatArray(shorts)

        val byteBuffer = ByteBuffer.wrap(bytes)
        byteBuffer.order(ByteOrder.LITTLE_ENDIAN)

        for (i in 0 until shorts) {
            val sample = byteBuffer.short.toInt()
            floats[i] = sample / 32768.0f // Normalize to [-1.0, 1.0]
        }

        return floats
    }
}
