package com.aimindmesh.mobile.proactive

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import com.aimindmesh.mobile.R
import org.json.JSONObject

/**
 * Helper class for creating and managing proactive notification channels
 * with user-configurable priority from ProactiveSettings
 */
class ProactiveNotificationHelper(private val context: Context) {

    companion object {
        private const val TAG = "ProactiveNotificationHelper"
        private const val CHANNEL_BASE_ID = "ProactiveChannel"
        private const val CHANNEL_VERSION = "v2" // Update when changing channel config
        const val CHANNEL_ID = "${CHANNEL_BASE_ID}_${CHANNEL_VERSION}"
        private const val PREFS_NAME = "CapacitorStorage"
        private const val SETTINGS_KEY = "proactive-settings"
    }

    /**
     * Creates or updates the notification channel based on user settings
     */
    fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val settings = loadProactiveSettings()
            
            val notificationPriority = settings.optJSONObject("notifications")?.optString("priority", "default") ?: "default"
            val channelName = "Proactive Assistant Service"
            val channelDescription = "Background monitoring for proactive suggestions"
            
            // Map priority string to Android importance level
            val importance = when (notificationPriority) {
                "min" -> NotificationManager.IMPORTANCE_MIN
                "low" -> NotificationManager.IMPORTANCE_LOW
                "high" -> NotificationManager.IMPORTANCE_HIGH
                else -> NotificationManager.IMPORTANCE_DEFAULT
            }
            
            Log.d(TAG, "Creating notification channel with priority: $notificationPriority (importance: $importance)")
            
            val channel = NotificationChannel(CHANNEL_ID, channelName, importance).apply {
                description = channelDescription
                
                // Apply sound/vibration settings
                val notifSettings = settings.optJSONObject("notifications")
                if (notifSettings != null) {
                    enableVibration(notifSettings.optBoolean("vibration", true))
                    
                    if (!notifSettings.optBoolean("sound", true)) {
                        setSound(null, null)
                    }
                    
                    enableLights(notifSettings.optBoolean("led", false))
                }
            }
            
            val manager = context.getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
            
            Log.d(TAG, "Notification channel created: $CHANNEL_ID")
        }
    }

    /**
     * Creates a notification for the foreground service
     */
    fun createForegroundNotification(): android.app.Notification {
        createNotificationChannel() // Ensure channel exists
        
        return NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle("AMM Mobile Proactive Service")
            .setContentText("Running background tasks for proactive suggestions...")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .build()
    }

    /**
     * Creates a proactive action notification
     */
    fun createActionNotification(title: String, message: String): android.app.Notification {
        createNotificationChannel() // Ensure channel exists
        
        val settings = loadProactiveSettings()
        val notifSettings = settings.optJSONObject("notifications")
        
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(message)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setAutoCancel(true)
        
        // Apply priority
        val priority = when (notifSettings?.optString("priority", "default")) {
            "min" -> NotificationCompat.PRIORITY_MIN
            "low" -> NotificationCompat.PRIORITY_LOW
            "high" -> NotificationCompat.PRIORITY_HIGH
            else -> NotificationCompat.PRIORITY_DEFAULT
        }
        builder.setPriority(priority)
        
        return builder.build()
    }

    /**
     * Loads proactive settings from SharedPreferences
     */
    private fun loadProactiveSettings(): JSONObject {
        val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val settingsJson = prefs.getString(SETTINGS_KEY, null)
        
        return if (settingsJson != null) {
            try {
                JSONObject(settingsJson)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to parse proactive settings", e)
                JSONObject()
            }
        } else {
            JSONObject()
        }
    }
}
