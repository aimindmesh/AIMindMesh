package com.aimindmesh.mobile.voxtral

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log
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
    private var readerThread: Thread? = null
    @Volatile
    private var isRecording = false

    companion object {
        private const val TAG = "AudioStreamProcessor"
        private const val BUFFER_SIZE_FACTOR = 2
        // A chunk being transcribed can take seconds; stop waits for it before the model is touched
        private const val STOP_JOIN_TIMEOUT_MS = 30_000L
    }

    /**
     * Start capturing audio on a dedicated thread.
     * @param onChunk: Callback with audio data (normalized float array), called on the capture thread
     * @return false when the microphone cannot be opened (permission denied, busy, unsupported)
     */
    fun startCapture(onChunk: (FloatArray) -> Unit): Boolean {
        val channelConfig = if (channels == 1) {
            AudioFormat.CHANNEL_IN_MONO
        } else {
            AudioFormat.CHANNEL_IN_STEREO
        }

        val minBuffer = AudioRecord.getMinBufferSize(
            sampleRate,
            channelConfig,
            AudioFormat.ENCODING_PCM_16BIT
        )
        if (minBuffer <= 0) {
            Log.e(TAG, "Unsupported audio configuration ($minBuffer)")
            return false
        }
        val bufferSize = minBuffer * BUFFER_SIZE_FACTOR

        val record = try {
            AudioRecord(
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                sampleRate,
                channelConfig,
                AudioFormat.ENCODING_PCM_16BIT,
                bufferSize
            )
        } catch (e: SecurityException) {
            Log.e(TAG, "Microphone permission denied", e)
            return false
        } catch (e: Exception) {
            Log.e(TAG, "Audio capture failed", e)
            return false
        }

        if (record.state != AudioRecord.STATE_INITIALIZED) {
            Log.e(TAG, "AudioRecord not initialized")
            record.release()
            return false
        }

        try {
            record.startRecording()
        } catch (e: Exception) {
            Log.e(TAG, "startRecording failed", e)
            record.release()
            return false
        }
        if (record.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
            // Another app holds the microphone
            Log.e(TAG, "AudioRecord did not start recording")
            record.release()
            return false
        }

        audioRecord = record
        isRecording = true
        readerThread = Thread({
            val buffer = ByteArray(bufferSize)
            while (isRecording) {
                val bytesRead = record.read(buffer, 0, buffer.size)
                if (bytesRead > 0 && isRecording) {
                    // Convert PCM16 to float32 normalized [-1.0, 1.0]
                    onChunk(pcm16ToFloat32(buffer, bytesRead))
                } else if (bytesRead < 0) {
                    Log.e(TAG, "AudioRecord read error $bytesRead")
                    break
                }
            }
        }, "Voxtral-Capture").also { it.start() }

        Log.i(TAG, "Audio capture started")
        return true
    }

    /**
     * Stop capturing audio. Blocks until the capture thread (and any chunk it is
     * processing) has finished, so callers can safely release or reset the model.
     */
    fun stopCapture() {
        isRecording = false
        val record = audioRecord
        try {
            record?.stop() // unblocks a pending read()
        } catch (e: IllegalStateException) {
            Log.w(TAG, "AudioRecord stop failed", e)
        }

        val thread = readerThread
        if (thread != null && thread !== Thread.currentThread()) {
            try {
                thread.join(STOP_JOIN_TIMEOUT_MS)
            } catch (e: InterruptedException) {
                Thread.currentThread().interrupt()
            }
            if (thread.isAlive) {
                Log.w(TAG, "Capture thread still busy after ${STOP_JOIN_TIMEOUT_MS}ms")
            }
        }
        readerThread = null

        record?.release()
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
