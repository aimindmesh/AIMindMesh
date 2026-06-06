package com.aimindmesh.mobile

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.service.voice.VoiceInteractionSession
import android.util.Log

class AssistantSession(context: Context) : VoiceInteractionSession(context) {
    
    override fun onShow(args: Bundle?, showFlags: Int) {
        super.onShow(args, showFlags)
        Log.i("AssistantSession", "onShow detected")
        
        // Launch the main activity in voice mode
        val intent = Intent(context, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
            putExtra("wakeWordDetected", true) // Re-use the wake word trigger logic
        }
        startVoiceActivity(intent)
        
        // Finish the session UI immediately as we are handing over to the App
        finish()
    }
}
