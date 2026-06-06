package com.aimindmesh.mobile.tts.kokoro

import android.content.Context
import com.k2fsa.sherpa.onnx.*

class KokoroTTSEngine(private val context: Context) {

    private var tts: OfflineTts? = null

    companion object {
        const val SAMPLE_RATE = 24000
        
        fun getLanguageForVoice(voiceId: String): String {
            return when {
                voiceId.startsWith("af_") || voiceId.startsWith("am_") -> "en-us"
                voiceId.startsWith("bf_") || voiceId.startsWith("bm_") -> "en-gb"
                voiceId.startsWith("if_") || voiceId.startsWith("im_") -> "it"
                else -> "en-us"
            }
        }
        
        fun getSpeakerId(voiceId: String): Int {
            return when (voiceId) {
                "af_sky" -> 3
                "am_michael" -> 4
                "bf_emma" -> 11
                "bm_george" -> 15
                "if_sara" -> 35
                "im_nicola" -> 36
                else -> 3
            }
        }
    }

    fun init(modelDir: String, lang: String = "it") {
        val kokoroConfig = OfflineTtsKokoroModelConfig(
            model    = "$modelDir/model.onnx",
            voices   = "$modelDir/voices.bin",
            tokens   = "$modelDir/tokens.txt",
            dataDir  = "$modelDir/espeak-ng-data",
            lang     = lang
        )

        val modelConfig = OfflineTtsModelConfig(
            kokoro       = kokoroConfig,
            numThreads   = 4,
            debug        = false,
            provider     = "cpu",
        )

        val ttsConfig = OfflineTtsConfig(model = modelConfig)
        tts = OfflineTts(config = ttsConfig)
    }

    fun synthesize(
        text: String,
        speakerId: Int,
        speed: Float = 1.0f
    ): FloatArray {
        val audio = tts?.generate(
            text      = text,
            sid       = speakerId,
            speed     = speed
        ) ?: throw IllegalStateException("TTS non inizializzato")
        return audio.samples
    }

    fun release() {
        tts = null
    }
}
