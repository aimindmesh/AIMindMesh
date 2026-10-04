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

    /** Most notifications posted at once: the rest are summed up in one (a burst after Doze) */
    const val MAX_NOTIFICATIONS = 3

    /**
     * Pure decision, unit tested. Nothing is fetched in quiet hours: the server marks items as
     * delivered when it returns them, so they would be shown in the middle of the night.
     */
    fun shouldPoll(config: ServerConfig, availabilityScore: Int, notificationsAllowed: Boolean, quietHours: Boolean = false): Boolean =
        config.enabled && config.isContextual && config.serverUrl.isNotBlank() && config.deviceId.isNotBlank() &&
            config.apiKey.isNotBlank() && notificationsAllowed && !quietHours && availabilityScore >= AVAILABILITY_THRESHOLD

    /** Insights shown one by one, and how many more are summed up in a single notification. */
    fun planNotifications(insights: List<PendingInsight>, max: Int = MAX_NOTIFICATIONS): Pair<List<PendingInsight>, Int> =
        insights.take(max) to (insights.size - max).coerceAtLeast(0)

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
        val manager = NotificationManagerCompat.from(context)
        if (!manager.areNotificationsEnabled()) return false
        // The user may have blocked just this channel: fetching would consume the items unseen
        val channel = manager.getNotificationChannel(ProactiveNotificationHelper.CHANNEL_ID)
        if (channel != null && channel.importance == NotificationManagerCompat.IMPORTANCE_NONE) return false
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
        val (shown, more) = planNotifications(insights)
        try {
            for (insight in shown) {
                val message = insight.content?.take(300) ?: "You have a new AI insight."
                manager.notify(insight.id.hashCode(), helper.createActionNotification("AI Insight", message))
            }
            if (more > 0) {
                manager.notify(MORE_NOTIFICATION_ID, helper.createActionNotification("AI Insights", "$more more insights are waiting in the Feed."))
            }
        } catch (e: SecurityException) {
            Log.w(TAG, "Notification permission revoked meanwhile", e)
        }
    }

    private const val MORE_NOTIFICATION_ID = 0x41494d
}
