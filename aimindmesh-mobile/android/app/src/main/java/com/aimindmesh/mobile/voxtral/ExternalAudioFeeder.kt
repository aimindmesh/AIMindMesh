package com.aimindmesh.mobile.voxtral

import android.util.Log
import com.aimindmesh.mobile.recording.RecordingAudioTaps
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * Feeds Voxtral with the meeting recorder's audio (one microphone for the whole app) instead of
 * opening its own: same samples and sample clock as the saved file.
 *
 * The recorder's consumer thread only copies each chunk into a bounded queue; inference runs on
 * this feeder's own thread. When Voxtral is slower than real time for too long, the oldest audio
 * is dropped (live text only: the recording is complete) and [onLagging] is called once.
 */
class ExternalAudioFeeder(
    private val maxQueuedChunks: Int = 600, // ~60 s of 100 ms recorder chunks
    private val onLagging: () -> Unit = {}
) : RecordingAudioTaps.Tap {

    private class Chunk(val samples: FloatArray, val startSample: Long)

    private val queue = ArrayBlockingQueue<Chunk>(maxQueuedChunks)
    @Volatile
    private var running = false
    @Volatile
    private var lagReported = false
    private var worker: Thread? = null

    /** Chunks dropped because Voxtral fell behind. */
    @Volatile
    var droppedChunks = 0L
        private set

    companion object {
        private const val TAG = "VoxtralExternal"
        private const val CHUNK_IN_FLIGHT_TIMEOUT_MS = 30_000L
    }

    override fun onAudio(samples: ShortArray, length: Int, sampleOffset: Long) {
        if (!running) return
        val floats = FloatArray(length) { samples[it] / 32768.0f }
        val chunk = Chunk(floats, sampleOffset)
        while (!queue.offer(chunk)) {
            queue.poll()
            droppedChunks++
            if (!lagReported) {
                lagReported = true
                Log.w(TAG, "Voxtral is behind the recording: dropping the oldest audio")
                onLagging()
            }
        }
    }

    /**
     * Starts receiving the recorder's audio. [onChunk] runs on the feeder's thread with the
     * samples and the position of the first one in the recording.
     */
    fun start(onChunk: (FloatArray, Long) -> Unit) {
        queue.clear()
        droppedChunks = 0
        lagReported = false
        running = true
        worker = Thread({
            while (true) {
                val chunk = queue.poll(200, TimeUnit.MILLISECONDS)
                if (chunk == null) {
                    if (!running) break
                    continue
                }
                try {
                    onChunk(chunk.samples, chunk.startSample)
                } catch (e: Exception) {
                    Log.e(TAG, "Voxtral failed on a chunk", e)
                }
            }
        }, "Voxtral-External").also { it.start() }
        RecordingAudioTaps.add(this)
    }

    /**
     * Stops receiving audio and lets Voxtral finish what is queued (the last words before Stop),
     * for at most [drainTimeoutMs]; then waits for the chunk in flight, so the model can be reset.
     */
    fun stop(drainTimeoutMs: Long = 10_000) {
        RecordingAudioTaps.remove(this)
        running = false
        val thread = worker ?: return
        worker = null
        if (thread === Thread.currentThread()) return
        try {
            thread.join(drainTimeoutMs)
            if (thread.isAlive) {
                Log.w(TAG, "Drain timeout: ${queue.size} chunks not transcribed")
                queue.clear()
                thread.join(CHUNK_IN_FLIGHT_TIMEOUT_MS)
            }
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
        }
    }
}
