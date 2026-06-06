package com.aimindmesh.mobile.proactive

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * Manages the pull-based delivery of pending insights from the AIMindMesh Server.
 * Only triggers if the device is in "Contextual" mode and is "Available".
 */
class ContextualDeliveryManager(private val context: Context) {

    private val TAG = "ContextualDeliveryMgr"
    private val PREFS_NAME = "CapacitorStorage"
    private val STATUS_KEY = "aimindmesh-server-settings"

    /**
     * Checks if we should poll, and if so, fetches pending deliveries.
     */
    fun checkAndDeliver(availabilityScore: Int) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val serverSettingsJson = prefs.getString(STATUS_KEY, null) ?: return

        try {
            val serverSettings = JSONObject(serverSettingsJson)
            val isEnabled = serverSettings.optBoolean("enabled", false)
            val deliveryMode = serverSettings.optString("deliveryMode", "PUSH")
            val serverUrl = serverSettings.optString("serverUrl", "")
            val apiKey = serverSettings.optString("apiKey", "")
            val deviceId = serverSettings.optString("deviceName", "Mobile Device")

            if (!isEnabled || deliveryMode != "CONTEXTUAL" || serverUrl.isEmpty()) {
                Log.d(TAG, "Contextual delivery not applicable (enabled=$isEnabled, mode=$deliveryMode)")
                return
            }

            // Threshold for delivery: 70
            if (availabilityScore < 70) {
                Log.d(TAG, "Availability too low ($availabilityScore < 70), skipping poll.")
                return
            }

            Log.d(TAG, "Device is AVAILABLE ($availabilityScore). Polling for pending insights...")
            pollForPendingInsights(serverUrl, apiKey, deviceId)

        } catch (e: Exception) {
            Log.e(TAG, "Failed to check contextual delivery settings", e)
        }
    }

    private fun pollForPendingInsights(serverUrl: String, apiKey: String, deviceId: String) {
        Thread {
            try {
                val url = URL("$serverUrl/api/delivery/pending")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "GET"
                conn.setRequestProperty("x-api-key", apiKey)
                conn.setRequestProperty("x-device-id", deviceId)
                conn.connectTimeout = 10000
                conn.readTimeout = 10000

                if (conn.responseCode == 200) {
                    val reader = BufferedReader(InputStreamReader(conn.inputStream))
                    val response = StringBuilder()
                    var line: String?
                    while (reader.readLine().also { line = it } != null) {
                        response.append(line)
                    }
                    reader.close()

                    val data = JSONObject(response.toString())
                    val items = data.optJSONArray("items")
                    if (items != null && items.length() > 0) {
                        Log.i(TAG, "Retrieved ${items.length()} pending insights! Triggering notifications...")
                        processDeliveredItems(items)
                    } else {
                        Log.d(TAG, "No pending insights found on server.")
                    }
                } else {
                    Log.e(TAG, "Polling failed: HTTP ${conn.responseCode}")
                }
                conn.disconnect()
            } catch (e: Exception) {
                Log.e(TAG, "Error during polling", e)
            }
        }.start()
    }

    private fun processDeliveredItems(items: JSONArray) {
        val helper = ProactiveNotificationHelper(context)
        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager

        for (i in 0 until items.length()) {
            val item = items.getJSONObject(i)
            val payload = item.getJSONObject("payload")
            val title = payload.optString("title", "Insight Ready")
            val message = payload.optString("body", "You have a new AI insight.")
            val insightId = item.optString("id", "delivery_$i")

            val notification = helper.createActionNotification(title, message)
            notificationManager.notify(insightId.hashCode(), notification)
        }
    }
}
