package com.aimindmesh.mobile

import android.service.voice.VoiceInteractionService
import android.util.Log

class AssistantVoiceInteractionService : VoiceInteractionService() {
    override fun onReady() {
        super.onReady()
        Log.i("AssistantVoiceService", "Voice Interaction Service Ready")
    }
}
