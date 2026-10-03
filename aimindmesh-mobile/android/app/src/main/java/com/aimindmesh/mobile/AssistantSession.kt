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

        // Hand over to the app in voice mode. startVoiceActivity() would throw a SecurityException
        // (MainActivity is not a CATEGORY_VOICE activity); a plain start is allowed because the
        // active VoiceInteractionService is exempt from background-activity-start limits.
        val intent = Intent(context, MainActivity::class.java).apply {
            action = Intent.ACTION_ASSIST
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
            putExtra("wakeWordDetected", true) // Re-use the wake word trigger logic
        }
        try {
            context.startActivity(intent)
        } catch (e: RuntimeException) {
            Log.e("AssistantSession", "Could not open the app from the assistant session", e)
        }

        // Finish the session UI immediately as we are handing over to the App
        finish()
    }
}
