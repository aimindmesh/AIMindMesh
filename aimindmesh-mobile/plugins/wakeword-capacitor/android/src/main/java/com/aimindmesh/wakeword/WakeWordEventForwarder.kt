package com.aimindmesh.wakeword

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import com.getcapacitor.JSObject

/**
 * Forwards BackgroundService broadcasts to plugin events. Besides detections it relays the
 * listening state and errors: JS keeps its own listening flag and, without these, never learned
 * that the service had stopped (so a disabled wake word was never stopped, or never restarted).
 */
internal class WakeWordEventForwarder(
    private val emit: (eventName: String, data: JSObject) -> Unit
) : BroadcastReceiver() {

    override fun onReceive(context: Context?, intent: Intent?) {
        when (intent?.action) {
            BackgroundService.BROADCAST_WAKE_WORD_DETECTED -> emit("wakeWordDetected", JSObject().apply {
                put("wakeWord", intent.getStringExtra(BackgroundService.EXTRA_WAKE_WORD))
                put("confidence", intent.getFloatExtra(BackgroundService.EXTRA_CONFIDENCE, 0f).toDouble())
                put("timestamp", System.currentTimeMillis())
            })
            BackgroundService.BROADCAST_STATE_CHANGED -> emit("listeningStateChanged", JSObject().apply {
                put("isListening", intent.getBooleanExtra(BackgroundService.EXTRA_IS_LISTENING, false))
            })
            BackgroundService.BROADCAST_ERROR -> emit("error", JSObject().apply {
                put("error", intent.getStringExtra(BackgroundService.EXTRA_ERROR) ?: "Unknown error")
                put("code", intent.getStringExtra(BackgroundService.EXTRA_ERROR_CODE) ?: "UNKNOWN_ERROR")
            })
        }
    }

    fun register(context: Context) {
        val filter = IntentFilter(BackgroundService.BROADCAST_WAKE_WORD_DETECTED).apply {
            addAction(BackgroundService.BROADCAST_STATE_CHANGED)
            addAction(BackgroundService.BROADCAST_ERROR)
        }
        // Same-process service: the broadcasts are package-scoped, no need to export
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(this, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            context.registerReceiver(this, filter)
        }
    }
}
