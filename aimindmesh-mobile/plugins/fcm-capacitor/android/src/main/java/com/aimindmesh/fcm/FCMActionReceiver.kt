package com.aimindmesh.fcm

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationManagerCompat

/**
 * Handles inline notification actions (Android 14+):
 * - MARK_READ: silently calls POST /api/feed/:id/read and dismisses the notification
 */
class FCMActionReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "FCMActionReceiver"
        const val ACTION_MARK_READ = "com.aimindmesh.fcm.ACTION_MARK_READ"
        const val EXTRA_INSIGHT_ID = "insight_id"
        const val EXTRA_NOTIFICATION_ID = "notification_id"

        fun buildMarkReadIntent(context: Context, notifId: Int, insightId: String): PendingIntent {
            val intent = Intent(context, FCMActionReceiver::class.java).apply {
                action = ACTION_MARK_READ
                putExtra(EXTRA_INSIGHT_ID, insightId)
                putExtra(EXTRA_NOTIFICATION_ID, notifId)
            }
            return PendingIntent.getBroadcast(
                context, notifId,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        val insightId = intent.getStringExtra(EXTRA_INSIGHT_ID) ?: return
        val notifId = intent.getIntExtra(EXTRA_NOTIFICATION_ID, -1)

        when (intent.action) {
            ACTION_MARK_READ -> {
                Log.d(TAG, "Mark-read action for insightId=$insightId")
                // Dismiss the notification immediately
                if (notifId != -1) {
                    NotificationManagerCompat.from(context).cancel(notifId)
                }
                // Emit event to JS so it can call POST /api/feed/:id/read
                FCMCapacitorPlugin.instance?.onForegroundMessage(
                    type = "MARK_READ_ACTION",
                    title = "",
                    body = "",
                    data = mapOf("insightId" to insightId)
                )
            }
        }
    }
}
