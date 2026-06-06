package com.aimindmesh.fcm

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.google.firebase.messaging.FirebaseMessaging
import android.util.Log

@CapacitorPlugin(
    name = "FCMCapacitor",
    permissions = [
        Permission(
            alias = "notifications",
            strings = [Manifest.permission.POST_NOTIFICATIONS]
        )
    ]
)
class FCMCapacitorPlugin : Plugin() {

    companion object {
        private const val TAG = "FCMCapacitorPlugin"
        private const val CHANNEL_ID = "aimindmesh_feed"
        private const val CHANNEL_NAME = "AIMindMesh Feed"

        /** Emitted to JS when a foreground message arrives */
        const val FCM_MESSAGE_EVENT = "fcm:message"
        /** Emitted to JS when the FCM token changes */
        const val FCM_TOKEN_EVENT = "fcm:tokenRefresh"

        // Singleton reference so the FCMService can emit events
        @Volatile
        var instance: FCMCapacitorPlugin? = null
    }

    override fun load() {
        super.load()
        instance = this
        createNotificationChannel()
    }

    override fun handleOnDestroy() {
        super.handleOnDestroy()
        instance = null
    }

    // ─── Plugin Methods ────────────────────────────────────────────────────────

    /** Returns the current FCM registration token */
    @PluginMethod
    fun getFCMToken(call: PluginCall) {
        FirebaseMessaging.getInstance().token
            .addOnSuccessListener { token ->
                val result = JSObject()
                result.put("token", token)
                call.resolve(result)
            }
            .addOnFailureListener { e ->
                call.reject("Failed to get FCM token: ${e.message}")
            }
    }

    /**
     * Request POST_NOTIFICATIONS permission (Android 13+).
     * On older versions resolves immediately with granted=true.
     */
    @PluginMethod
    fun requestPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            val result = JSObject()
            result.put("granted", true)
            call.resolve(result)
            return
        }
        requestPermissionForAlias("notifications", call, "onNotificationPermissionResult")
    }

    @PermissionCallback
    private fun onNotificationPermissionResult(call: PluginCall) {
        val granted = ActivityCompat.checkSelfPermission(
            context,
            Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
        val result = JSObject()
        result.put("granted", granted)
        call.resolve(result)
    }

    // ─── Internal: called by FCMMessagingService ────────────────────────────────

    /** Forwards an FCM message to the JS layer as a Capacitor event */
    fun onForegroundMessage(type: String, title: String, body: String, data: Map<String, String>) {
        val payload = JSObject()
        payload.put("type", type)
        payload.put("title", title)
        payload.put("body", body)
        val dataObj = JSObject()
        data.forEach { (k, v) -> dataObj.put(k, v) }
        payload.put("data", dataObj)
        notifyListeners(FCM_MESSAGE_EVENT, payload)
        Log.d(TAG, "Forwarded FCM message to JS: type=$type")
    }

    /** Called when FCM rotates the device token */
    fun onTokenRefreshed(newToken: String) {
        val payload = JSObject()
        payload.put("token", newToken)
        notifyListeners(FCM_TOKEN_EVENT, payload)
    }

    // ─── Notification Channel ─────────────────────────────────────────────────

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "AIMindMesh insights and alerts"
            }
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    /** Display a system tray notification with Open and Mark Read actions */
    fun showNotification(
        notifId: Int,
        title: String,
        body: String,
        insightId: String?,
        launcherClass: Class<*>
    ) {
        val openIntent = Intent(context, launcherClass).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            putExtra("navigate_to", "feed")
            if (insightId != null) putExtra("insight_id", insightId)
        }
        val openPi = PendingIntent.getActivity(
            context, notifId,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info) // replaced by real icon at build time
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(openPi)

        if (insightId != null) {
            val markReadIntent = FCMActionReceiver.buildMarkReadIntent(context, notifId, insightId)
            builder.addAction(0, "Mark Read", markReadIntent)
        }

        if (ActivityCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED
        ) {
            NotificationManagerCompat.from(context).notify(notifId, builder.build())
        }
    }
}
