package com.aimindmesh.mobile.audio

import android.net.Uri
import android.util.Log
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File

@CapacitorPlugin(name = "AudioPlayback")
class AudioPlaybackPlugin : Plugin() {
    private var player: ExoPlayer? = null
    private var currentEndMs: Long = -1L
    private val TAG = "AudioPlaybackPlugin"

    private val progressRunnable = object : Runnable {
        override fun run() {
            player?.let { exo ->
                if (exo.isPlaying) {
                    val currentPosition = exo.currentPosition
                    
                    // Stop if we reached the target end time
                    if (currentEndMs > 0 && currentPosition >= currentEndMs) {
                        exo.pause()
                        notifyStateChange("completed")
                        currentEndMs = -1L // Reset
                    } else {
                        // Notify progress
                        val info = JSObject()
                        info.put("currentPosition", currentPosition)
                        // Note: duration in ExoPlayer might be C.TIME_UNSET if unknown
                        val duration = if (exo.duration != C.TIME_UNSET) exo.duration else 0
                        info.put("duration", duration)
                        
                        // We also need to send the original start/end ms so JS can calculate relative progress
                        // But since we just want to send progress, we'll let JS handle the math if we send current pos.
                        info.put("startMs", lastStartMs)
                        info.put("endMs", lastEndMs)
                        
                        notifyListeners("playbackProgress", info)
                    }
                    
                    // Re-schedule
                    if (exo.isPlaying) {
                        handler.postDelayed(this, 100)
                    }
                }
            }
        }
    }

    private var handler = android.os.Handler(android.os.Looper.getMainLooper())
    private var lastStartMs: Long = 0
    private var lastEndMs: Long = 0

    override fun load() {
        super.load()
        activity?.runOnUiThread {
            initializePlayer()
        }
    }

    private fun initializePlayer() {
        if (player == null) {
            // Configure AudioAttributes to ensure it behaves well with background recording/calls
            val audioAttributes = AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
                .build()

            player = ExoPlayer.Builder(context).build().apply {
                setAudioAttributes(audioAttributes, true)
                addListener(object : Player.Listener {
                    override fun onPlaybackStateChanged(playbackState: Int) {
                        when (playbackState) {
                            Player.STATE_READY -> notifyStateChange(if (isPlaying) "playing" else "paused")
                            Player.STATE_ENDED -> notifyStateChange("completed")
                            Player.STATE_IDLE -> notifyStateChange("idle")
                        }
                    }

                    override fun onIsPlayingChanged(isPlaying: Boolean) {
                        notifyStateChange(if (isPlaying) "playing" else "paused")
                        if (isPlaying) {
                            handler.post(progressRunnable)
                        } else {
                            handler.removeCallbacks(progressRunnable)
                        }
                    }

                    override fun onPlayerError(error: PlaybackException) {
                        Log.e(TAG, "ExoPlayer Error: ${error.message}", error)
                        val data = JSObject()
                        data.put("state", "error")
                        data.put("error", error.message)
                        notifyListeners("playbackStateChanged", data)
                    }
                })
            }
        }
    }

    @PluginMethod
    fun playSegment(call: PluginCall) {
        val filePath = call.getString("filePath")
        val startMs = call.getInt("startMs")?.toLong() ?: 0L
        val endMs = call.getInt("endMs")?.toLong() ?: -1L
        val speed = call.getFloat("speed") ?: 1.0f

        if (filePath == null) {
            call.reject("Must provide filePath")
            return
        }

        activity?.runOnUiThread {
            try {
                if (player == null) {
                    initializePlayer()
                }

                // Strip file:// prefix if present to handle raw filesystem paths
                val cleanPath = filePath.removePrefix("file://")
                val uri = Uri.fromFile(File(cleanPath))
                val mediaItem = MediaItem.fromUri(uri)

                lastStartMs = startMs
                lastEndMs = endMs
                currentEndMs = endMs

                player?.apply {
                    setMediaItem(mediaItem)
                    prepare()
                    seekTo(startMs)
                    playbackParameters = PlaybackParameters(speed)
                    play()
                }

                call.resolve()
            } catch (e: Exception) {
                Log.e(TAG, "Error playing segment", e)
                call.reject("Failed to play segment: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun pause(call: PluginCall) {
        activity?.runOnUiThread {
            player?.pause()
            call.resolve()
        }
    }

    @PluginMethod
    fun resume(call: PluginCall) {
        activity?.runOnUiThread {
            player?.play()
            call.resolve()
        }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        activity?.runOnUiThread {
            player?.stop()
            player?.clearMediaItems()
            currentEndMs = -1L
            // notifyStateChange("stopped") // Usually triggered by state change listener
            call.resolve()
        }
    }

    @PluginMethod
    fun setSpeed(call: PluginCall) {
        val speed = call.getFloat("speed") ?: 1.0f
        activity?.runOnUiThread {
            player?.playbackParameters = PlaybackParameters(speed)
            call.resolve()
        }
    }

    private fun notifyStateChange(state: String) {
        val data = JSObject()
        data.put("state", state)
        notifyListeners("playbackStateChanged", data)
    }

    override fun handleOnDestroy() {
        super.handleOnDestroy()
        handler.removeCallbacks(progressRunnable)
        activity?.runOnUiThread {
            player?.release()
            player = null
        }
    }
}
