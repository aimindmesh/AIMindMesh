package com.aimindmesh.mobile.tts.kokoro

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.*

@CapacitorPlugin(name = "KokoroTTS")
class KokoroTTSPlugin : Plugin() {

    private var engine: KokoroTTSEngine? = null
    private var audioTrack: AudioTrack? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val SAMPLE_RATE = KokoroTTSEngine.SAMPLE_RATE
    private var isLoaded = false
    private var currentVoiceId = ""
    private var currentLang = ""
    private var isSpeaking = false
    
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
                if (engine == null || currentLang != requestedLang) {
                    engine?.release()
                    engine = KokoroTTSEngine(context)
                    val modelDir = ModelDownloader.getModelDir(context)
                    engine?.init(modelDir, requestedLang)
                    currentLang = requestedLang
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
            engine?.release()
            engine = null
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

        scope.launch {
            try {
                isSpeaking = true
                val sentences = text.split(Regex("(?<=[.!?;])\\s+"))
                for (sentence in sentences) {
                    if (sentence.isBlank() || !isSpeaking) continue
                    val audioData = engine!!.synthesize(sentence, speakerId, 1.0f)
                    playAudio(audioData)
                }
                isSpeaking = false
                call.resolve()
            } catch (e: Exception) {
                isSpeaking = false
                Log.e("KokoroTTS", "Synthesis error", e)
                call.reject("Synthesis error: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        audioTrack?.pause()
        audioTrack?.flush()
        isSpeaking = false
        call.resolve()
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

    private fun playAudio(pcmData: FloatArray) {
        if (!isSpeaking) return
        
        val bufferSize = AudioTrack.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_FLOAT
        )

        val usage = if (currentOutput == "earpiece") AudioAttributes.USAGE_VOICE_COMMUNICATION else AudioAttributes.USAGE_ASSISTANT
        val contentType = AudioAttributes.CONTENT_TYPE_SPEECH

        audioTrack?.release()
        audioTrack = AudioTrack.Builder()
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

        audioTrack?.play()
        audioTrack?.write(pcmData, 0, pcmData.size, AudioTrack.WRITE_BLOCKING)
        audioTrack?.stop()
        audioTrack?.release()
        audioTrack = null
    }

    override fun handleOnDestroy() {
        super.handleOnDestroy()
        scope.cancel()
        engine?.release()
        audioTrack?.release()
    }
}
