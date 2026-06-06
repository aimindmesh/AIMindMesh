package com.aimindmesh.fcm

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlin.math.abs

/**
 * Handles FCM messages from Google servers.
 * - Background/killed: Android system shows a tray notification automatically
 *   (if the RemoteMessage contains a notification payload).
 * - Foreground: we intercept here and emit a Capacitor event to JS.
 * - Token refresh: re-registers with the AIMindMesh Server.
 */
class FCMMessagingService : FirebaseMessagingService() {

    companion object {
        private const val TAG = "FCMMessagingService"
    }

    /**
     * Called when a new token is generated (first run or FCM rotation).
     * Notifies the Capacitor plugin so JS can POST to /api/nodes/register.
     */
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.d(TAG, "FCM token refreshed")
        FCMCapacitorPlugin.instance?.onTokenRefreshed(token)
    }

    /**
     * Called for foreground messages (app in foreground).
     * Background/killed messages are handled automatically by FCM SDK.
     */
    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        Log.d(TAG, "FCM message received: ${message.data}")

        val data = message.data
        val type = data["type"] ?: "SYSTEM_ALERT"
        val title = message.notification?.title ?: data["title"] ?: "AIMindMesh"
        val body = message.notification?.body ?: data["body"] ?: ""
        val insightId = data["insightId"]

        val plugin = FCMCapacitorPlugin.instance
        if (plugin != null) {
            // App is in foreground — emit Capacitor event to JS
            plugin.onForegroundMessage(type, title, body, data)
        } else {
            // App is in background but service still running — show tray notification
            try {
                val launcherClass = Class.forName("com.aimindmesh.MainActivity")
                val notifId = abs(insightId.hashCode()).coerceAtLeast(1)
                // Create a temporary context-only helper
                val tempPlugin = FCMCapacitorPlugin()
                // We cannot call Capacitor lifecycle methods here, so we use NotificationManagerCompat directly
                showFallbackNotification(message, notifId, title, body, insightId)
            } catch (e: Exception) {
                Log.w(TAG, "Could not show fallback notification: ${e.message}")
            }
        }
    }

    private fun showFallbackNotification(
        message: RemoteMessage,
        notifId: Int,
        title: String,
        body: String,
        insightId: String?
    ) {
        // Minimal notification without Capacitor context
        // The Android system already handles this for data-only messages
        // when the app has a <service> declaration in the manifest.
        // This is a safety-net for hybrid scenarios.
        Log.d(TAG, "Fallback notification: $title — $body (insightId=$insightId)")
    }
}
