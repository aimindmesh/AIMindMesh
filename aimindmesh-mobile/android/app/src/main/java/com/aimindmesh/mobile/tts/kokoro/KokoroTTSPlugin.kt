package com.aimindmesh.mobile.tts.kokoro

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.SystemClock
import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.atomic.AtomicLong

@CapacitorPlugin(name = "KokoroTTS")
class KokoroTTSPlugin : Plugin() {

    @Volatile private var engine: KokoroTTSEngine? = null
    // Track of the sentence currently playing, so stop() can cut it (guarded by trackLock)
    private var audioTrack: AudioTrack? = null
    private val trackLock = Any()
    // Serializes synthesis with engine init/release: freeing the model mid-generate would crash
    private val engineMutex = Mutex()
    // Each speak() owns a session; stop() or a newer speak() invalidates the older one, which
    // previously kept reading its remaining sentences once the shared flag flipped back to true
    private val speakSession = AtomicLong(0)
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val SAMPLE_RATE = KokoroTTSEngine.SAMPLE_RATE
    @Volatile private var isLoaded = false
    @Volatile private var currentVoiceId = ""
    private var currentLang = ""
    
    private var currentOutput = "speaker"

    override fun load() {
        super.load()
        engine = KokoroTTSEngine(context)
    }

    @PluginMethod
    fun isVoiceLoaded(call: PluginCall) {
        val ret = JSObject()
        ret.put("loaded", isLoaded)
        call.resolve(ret)
    }

    @PluginMethod
    fun getVoiceInfo(call: PluginCall) {
        val ret = JSObject()
        ret.put("voiceId", currentVoiceId)
        call.resolve(ret)
    }

    @PluginMethod
    fun isModelReady(call: PluginCall) {
        val ready = ModelDownloader.isModelReady(context)
        val ret = JSObject()
        ret.put("ready", ready)
        call.resolve(ret)
    }

    @PluginMethod
    fun downloadModel(call: PluginCall) {
        ModelDownloader.ensureModel(
            context = context,
            onProgress = { progress, message ->
                val data = JSObject()
                data.put("progress", progress)
                data.put("message", message)
                notifyListeners("onDownloadProgress", data)
            },
            onComplete = { _ ->
                notifyListeners("onDownloadComplete", JSObject())
                call.resolve()
            },
            onError = { error ->
                val err = JSObject()
                err.put("error", error)
                notifyListeners("onDownloadError", err)
                call.reject(error)
            }
        )
    }

    @PluginMethod
    fun importModel(call: PluginCall) {
        val path = call.getString("path")
        if (path == null) {
            call.reject("Path is required")
            return
        }

        ModelDownloader.extractLocalModel(
            context = context,
            sourceFilePath = path,
            onProgress = { progress, message ->
                val data = JSObject()
                data.put("progress", progress)
                data.put("message", message)
                notifyListeners("onDownloadProgress", data)
            },
            onComplete = { _ ->
                notifyListeners("onDownloadComplete", JSObject())
                call.resolve()
            },
            onError = { error ->
                val err = JSObject()
                err.put("error", error)
                notifyListeners("onDownloadError", err)
                call.reject(error)
            }
        )
    }

    @PluginMethod
    fun loadVoice(call: PluginCall) {
        val voiceId = call.getString("voiceId") ?: "if_sara"
        
        if (!ModelDownloader.isModelReady(context)) {
            call.reject("Model not ready. Call downloadModel first.")
            return
        }

        scope.launch {
            try {
                val requestedLang = KokoroTTSEngine.getLanguageForVoice(voiceId)
                engineMutex.withLock {
                    if (engine == null || currentLang != requestedLang) {
                        engine?.release()
                        engine = null
                        val newEngine = KokoroTTSEngine(context)
                        newEngine.init(ModelDownloader.getModelDir(context), requestedLang)
                        engine = newEngine
                        currentLang = requestedLang
                    }
                }
                
                isLoaded = true
                currentVoiceId = voiceId
                call.resolve()
            } catch (e: Exception) {
                Log.e("KokoroTTS", "Failed to load voice", e)
                call.reject("Failed to load voice: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun unloadVoice(call: PluginCall) {
        scope.launch {
            engineMutex.withLock {
                engine?.release()
                engine = null
            }
            isLoaded = false
            currentVoiceId = ""
            currentLang = ""
            call.resolve()
        }
    }

    @PluginMethod
    fun speak(call: PluginCall) {
        val text = call.getString("text")
        if (text == null) {
            call.reject("Text is required")
            return
        }

        if (!isLoaded || engine == null) {
            call.reject("Voice not loaded")
            return
        }

        val speakerId = KokoroTTSEngine.getSpeakerId(currentVoiceId)
        val session = speakSession.incrementAndGet()

        scope.launch {
            try {
                val sentences = text.split(Regex("(?<=[.!?;])\\s+"))
                for (sentence in sentences) {
                    if (speakSession.get() != session) break
                    if (sentence.isBlank()) continue
                    val audioData = engineMutex.withLock {
                        if (speakSession.get() != session) null
                        else (engine ?: throw IllegalStateException("Voice not loaded"))
                            .synthesize(sentence, speakerId, 1.0f)
                    } ?: break
                    playAudio(audioData, session)
                }
                call.resolve()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.e("KokoroTTS", "Synthesis error", e)
                call.reject("Synthesis error: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        speakSession.incrementAndGet()
        haltCurrentTrack()
        call.resolve()
    }

    /** Cuts the playing sentence; pause() also wakes a blocking write() so the speak loop can exit. */
    private fun haltCurrentTrack() {
        synchronized(trackLock) {
            audioTrack?.let {
                try {
                    it.pause()
                    it.flush()
                } catch (e: IllegalStateException) {
                    Log.w("KokoroTTS", "Failed to halt AudioTrack", e)
                }
            }
        }
    }

    @PluginMethod
    fun setAudioOutput(call: PluginCall) {
        currentOutput = call.getString("output") ?: "speaker"
        call.resolve()
    }

    @PluginMethod
    fun getAvailableAudioOutputs(call: PluginCall) {
        val ret = JSObject()
        ret.put("outputs", org.json.JSONArray(listOf("speaker", "earpiece")))
        call.resolve(ret)
    }

    private suspend fun playAudio(pcmData: FloatArray, session: Long) {
        if (speakSession.get() != session || pcmData.isEmpty()) return
        
        val bufferSize = AudioTrack.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_FLOAT
        )

        val usage = if (currentOutput == "earpiece") AudioAttributes.USAGE_VOICE_COMMUNICATION else AudioAttributes.USAGE_ASSISTANT
        val contentType = AudioAttributes.CONTENT_TYPE_SPEECH

        val track = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(usage)
                    .setContentType(contentType)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setSampleRate(SAMPLE_RATE)
                    .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setBufferSizeInBytes(bufferSize * 4)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()

        synchronized(trackLock) {
            if (speakSession.get() != session) {
                track.release()
                return
            }
            audioTrack = track
        }

        try {
            track.play()
            track.write(pcmData, 0, pcmData.size, AudioTrack.WRITE_BLOCKING)
            // write() returns once the samples are buffered, not played: releasing right away
            // clipped the last few hundred ms of every sentence, so wait for the head to drain.
            val maxWaitMs = pcmData.size * 1000L / SAMPLE_RATE + 1000L
            val startedAt = SystemClock.elapsedRealtime()
            while (speakSession.get() == session &&
                track.playbackHeadPosition < pcmData.size &&
                SystemClock.elapsedRealtime() - startedAt < maxWaitMs) {
                delay(20)
            }
        } finally {
            synchronized(trackLock) {
                if (audioTrack === track) audioTrack = null
            }
            try {
                track.stop()
            } catch (e: IllegalStateException) {
                // Already stopped or never started
            }
            track.release()
        }
    }

    override fun handleOnDestroy() {
        super.handleOnDestroy()
        speakSession.incrementAndGet()
        haltCurrentTrack()
        scope.cancel()
        val oldEngine = engine
        engine = null
        // Free only after an in-flight synthesis has left the engine (it cannot be interrupted)
        CoroutineScope(Dispatchers.IO).launch {
            engineMutex.withLock { oldEngine?.release() }
        }
    }
}
