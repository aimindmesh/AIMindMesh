package com.aimindmesh.fcm

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Handles FCM messages from Google servers.
 * - Notification messages (insights) while the app is in background: shown by the system
 *   tray, this service is not called.
 * - Data-only messages (the server's control messages WAKE_FOR_INFERENCE and SYNC_REQUEST)
 *   always reach onMessageReceived, also in background.
 * - Token refresh: re-registers with the AIMindMesh Server.
 */
class FCMMessagingService : FirebaseMessagingService() {

    companion object {
        private const val TAG = "FCMMessagingService"
    }

    /**
     * Called when a new token is generated (first run or FCM rotation).
     * Notifies the Capacitor plugin so JS can POST to /api/nodes/register.
     * Without the app running the token is registered at the next start (initFCMService).
     */
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.d(TAG, "FCM token refreshed")
        FCMCapacitorPlugin.instance?.onTokenRefreshed(token)
    }

    /**
     * Called for data-only messages, and for notification messages while the app is in the foreground.
     */
    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        Log.d(TAG, "FCM message received: type=${message.data["type"]}")

        val data = message.data
        val type = data["type"] ?: "SYSTEM_ALERT"
        val title = message.notification?.title ?: data["title"] ?: "AIMindMesh"
        val body = message.notification?.body ?: data["body"] ?: ""
        val insightId = data["insightId"]

        val plugin = FCMCapacitorPlugin.instance
        if (plugin != null) {
            // The app is running (foreground or background): JS acts on it, WAKE_FOR_INFERENCE
            // connects the node and SYNC_REQUEST runs the sync
            plugin.onForegroundMessage(type, title, body, data)
            return
        }

        // App not running: no JS to act now
        val notifId = ((insightId ?: type).hashCode() and 0x7fffffff).coerceAtLeast(1)
        when (type) {
            "SYNC_REQUEST" -> FCMCapacitorPlugin.markSyncPending(applicationContext)
            "WAKE_FOR_INFERENCE" -> FCMCapacitorPlugin.postNotification(
                applicationContext, notifId, title,
                "Open AIMindMesh to connect this device to the server.", null
            )
            else -> FCMCapacitorPlugin.postNotification(applicationContext, notifId, title, body, insightId)
        }
    }
}
