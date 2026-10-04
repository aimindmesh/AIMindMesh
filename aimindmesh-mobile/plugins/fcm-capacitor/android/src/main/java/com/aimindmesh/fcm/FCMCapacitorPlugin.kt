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
        private const val PREFS = "aimindmesh_fcm"
        private const val KEY_PENDING_SYNC = "pending_sync"

        /** Emitted to JS when a foreground message arrives */
        const val FCM_MESSAGE_EVENT = "fcm:message"
        /** Emitted to JS when the FCM token changes */
        const val FCM_TOKEN_EVENT = "fcm:tokenRefresh"

        // Singleton reference so the FCMService can emit events
        @Volatile
        var instance: FCMCapacitorPlugin? = null

        /** Feed channel. Also created from the messaging service, which may run without the app. */
        fun ensureChannel(context: Context) {
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

        /** POST_NOTIFICATIONS exists (and is checked) only from Android 13 */
        fun canPostNotifications(context: Context): Boolean {
            if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
            return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                ActivityCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
        }

        /** Tray notification opening the app's launcher activity (whatever its class name) */
        fun postNotification(context: Context, notifId: Int, title: String, body: String, insightId: String?) {
            ensureChannel(context)
            if (!canPostNotifications(context)) return

            val builder = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info) // replaced by real icon at build time
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)

            val openIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
            if (openIntent != null) {
                // Brings the running app forward (onNewIntent): CLEAR_TASK would recreate the activity
            // and reload the WebView, dropping the worker link and any generation in progress
            openIntent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                openIntent.putExtra("navigate_to", "feed")
                if (insightId != null) openIntent.putExtra("insight_id", insightId)
                builder.setContentIntent(
                    PendingIntent.getActivity(
                        context, notifId, openIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                    )
                )
            }

            if (insightId != null) {
                val markReadIntent = FCMActionReceiver.buildMarkReadIntent(context, notifId, insightId)
                builder.addAction(0, "Mark Read", markReadIntent)
            }

            try {
                NotificationManagerCompat.from(context).notify(notifId, builder.build())
            } catch (e: SecurityException) {
                Log.w(TAG, "Notification permission revoked meanwhile", e)
            }
        }

        /** A SYNC_REQUEST arrived while no JS could run it: the app syncs when it starts (getPendingActions) */
        fun markSyncPending(context: Context) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putBoolean(KEY_PENDING_SYNC, true)
                .apply()
        }
    }

    override fun load() {
        super.load()
        instance = this
        ensureChannel(context)
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

    /** Work requested by FCM while the app was not running: `{ syncRequested }`, cleared once read */
    @PluginMethod
    fun getPendingActions(call: PluginCall) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val syncRequested = prefs.getBoolean(KEY_PENDING_SYNC, false)
        prefs.edit().remove(KEY_PENDING_SYNC).apply()
        val result = JSObject()
        result.put("syncRequested", syncRequested)
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

    /** Display a system tray notification with Open and Mark Read actions */
    fun showNotification(notifId: Int, title: String, body: String, insightId: String?) {
        postNotification(context, notifId, title, body, insightId)
    }
}
