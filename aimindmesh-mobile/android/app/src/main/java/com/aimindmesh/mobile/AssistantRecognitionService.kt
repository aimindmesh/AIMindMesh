package com.aimindmesh.mobile

import android.content.Intent
import android.os.RemoteException
import android.speech.RecognitionService
import android.speech.SpeechRecognizer
import android.util.Log

/**
 * Recognition service required by the voice-interaction declaration (the system refuses an
 * assistant without one). Speech is transcribed inside the app (Whisper/Voxtral), so system-wide
 * SpeechRecognizer clients get an immediate error instead of binding to a missing component.
 */
class AssistantRecognitionService : RecognitionService() {

    override fun onStartListening(recognizerIntent: Intent?, listener: RecognitionService.Callback?) {
        Log.i("AssistantRecognition", "System speech recognition is not provided by this app")
        try {
            listener?.error(SpeechRecognizer.ERROR_CLIENT)
        } catch (e: RemoteException) {
            Log.w("AssistantRecognition", "Client went away", e)
        }
    }

    override fun onCancel(listener: RecognitionService.Callback?) {}

    override fun onStopListening(listener: RecognitionService.Callback?) {}
}
