package com.aimindmesh.mobile.proactive

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** One insight queued for this device by the server (GET /api/delivery/pending). */
data class PendingInsight(val id: String, val insightId: String, val content: String?)

/**
 * Pull-based delivery of pending insights in CONTEXTUAL mode.
 * The server marks items as delivered when it returns them, so nothing is fetched
 * unless a notification can actually be shown.
 */
object DeliveryClient {
    private const val TAG = "DeliveryClient"
    const val AVAILABILITY_THRESHOLD = 70
    private const val TIMEOUT_MS = 10_000

    /** Pure decision, unit tested. */
    fun shouldPoll(config: ServerConfig, availabilityScore: Int, notificationsAllowed: Boolean): Boolean =
        config.enabled && config.isContextual && config.serverUrl.isNotBlank() && config.deviceId.isNotBlank() &&
            config.apiKey.isNotBlank() && notificationsAllowed && availabilityScore >= AVAILABILITY_THRESHOLD

    /** `{ items: [{ id, insightId, deviceId, createdAt, content? }], count }` */
    fun parsePending(body: String): List<PendingInsight> {
        val items = JSONObject(body).optJSONArray("items") ?: return emptyList()
        return (0 until items.length()).mapNotNull { i ->
            val item = items.optJSONObject(i) ?: return@mapNotNull null
            val id = item.optString("id")
            if (id.isEmpty()) return@mapNotNull null
            val content = if (item.isNull("content")) null else item.optString("content").takeIf { it.isNotBlank() }
            PendingInsight(id, item.optString("insightId"), content)
        }
    }

    fun notificationsAllowed(context: Context): Boolean {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    }

    /** Blocking: call it off the main thread. */
    fun fetchPending(config: ServerConfig): List<PendingInsight> {
        val conn = URL("${config.serverUrl}/api/delivery/pending").openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "GET"
            conn.setRequestProperty("x-api-key", config.apiKey)
            conn.setRequestProperty("x-device-id", config.deviceId)
            conn.connectTimeout = TIMEOUT_MS
            conn.readTimeout = TIMEOUT_MS
            if (conn.responseCode != 200) {
                Log.w(TAG, "Polling failed: HTTP ${conn.responseCode}")
                return emptyList()
            }
            return parsePending(conn.inputStream.bufferedReader().use { it.readText() })
        } finally {
            conn.disconnect()
        }
    }

    fun notify(context: Context, insights: List<PendingInsight>) {
        val helper = ProactiveNotificationHelper(context)
        val manager = NotificationManagerCompat.from(context)
        for (insight in insights) {
            val message = insight.content?.take(300) ?: "You have a new AI insight."
            try {
                manager.notify(insight.id.hashCode(), helper.createActionNotification("AI Insight", message))
            } catch (e: SecurityException) {
                Log.w(TAG, "Notification permission revoked meanwhile", e)
            }
        }
    }
}
