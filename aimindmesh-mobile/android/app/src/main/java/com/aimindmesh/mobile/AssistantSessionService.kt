package com.aimindmesh.mobile

import android.os.Bundle
import android.service.voice.VoiceInteractionSession
import android.service.voice.VoiceInteractionSessionService

class AssistantSessionService : VoiceInteractionSessionService() {
    override fun onNewSession(bundle: Bundle?): VoiceInteractionSession {
        return AssistantSession(this)
    }
}
