package com.aimindmesh.mobile.proactive

import android.app.AlarmManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log

class ProactiveBackgroundService : Service() {

    private val TAG = "ProactiveBackgroundService"
    private var isRunning = false
    private val PROACTIVE_INTERVAL = 15 * 60 * 1000L // 15 minutes
    
    private lateinit var availabilityCalculator: AvailabilityScoreCalculator
    private lateinit var deliveryManager: ContextualDeliveryManager

    companion object {
        private const val WAKE_LOCK_TAG = "AIMindMesh:ProactiveWakeLock"
        private const val ALARM_REQUEST_CODE = 1001
        const val ACTION_CHECK = "com.aimindmesh.mobile.proactive.ACTION_CHECK"
    }

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "Service Created")
        availabilityCalculator = AvailabilityScoreCalculator(this)
        deliveryManager = ContextualDeliveryManager(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "Service onStartCommand: ${intent?.action}")

        // Check settings to ensure we should actually be running
        val prefs = getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
        val settingsJson = prefs.getString("proactive-settings", null)
        var isEnabled = true
        if (settingsJson != null) {
            try {
                val settings = org.json.JSONObject(settingsJson)
                isEnabled = settings.optBoolean("enabled", true)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to parse settings in service", e)
            }
        }

        if (!isEnabled) {
            Log.d(TAG, "Proactive Assistant is disabled in settings, stopping service immediately")
            stopSelf()
            return START_NOT_STICKY
        }

        if (intent?.action == ACTION_CHECK) {
            performCheckWithWakeLock()
        }

        if (!isRunning) {
            isRunning = true
            scheduleNextAlarm()
        }

        return START_STICKY
    }

    private fun scheduleNextAlarm() {
        val alarmManager = getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val intent = Intent(this, ProactiveBackgroundService::class.java).apply {
            action = ACTION_CHECK
        }
        
        // FLAG_IMMUTABLE is required for Android 12+
        val pendingIntent = PendingIntent.getService(
            this,
            ALARM_REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Use setAndAllowWhileIdle to wake up even if in Doze mode
        // triggerAtMillis: execute 15 mins from now
        val triggerAtMillis = SystemClock.elapsedRealtime() + PROACTIVE_INTERVAL

        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
            alarmManager.setAndAllowWhileIdle(
                AlarmManager.ELAPSED_REALTIME_WAKEUP,
                triggerAtMillis,
                pendingIntent
            )
        } else {
            alarmManager.setExact(
                AlarmManager.ELAPSED_REALTIME_WAKEUP,
                triggerAtMillis,
                pendingIntent
            )
        }
        
        Log.d(TAG, "Scheduled next proactive check for ${PROACTIVE_INTERVAL / 1000}s from now")
    }

    private fun performCheckWithWakeLock() {
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        val wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG)

        try {
            // Acquire lock for max 60 seconds to ensure JS execution completes heavy tasks
            wakeLock.acquire(60 * 1000L)
            Log.d(TAG, "WakeLock acquired for check")

            performCheck()
            
            // Re-schedule the next alarm since we just consumed one
            scheduleNextAlarm()
            
        } catch (e: Exception) {
            Log.e(TAG, "Error acquiring WakeLock", e)
        } finally {
            if (wakeLock.isHeld) {
                wakeLock.release()
                Log.d(TAG, "WakeLock released")
            }
        }
    }

    private fun performCheck() {
        Log.d(TAG, "Performing Proactive Check & Contextual Delivery...")
        
        // 1. Contextual Delivery (Pull from Server)
        val score = availabilityCalculator.calculateScore()
        deliveryManager.checkAndDeliver(score)
        
        // 2. Local Proactive Check Broadcast
        val intent = Intent("com.aimindmesh.PROACTIVE_CHECK")
        intent.putExtra("timestamp", System.currentTimeMillis())
        // Send implicit broadcast (to be picked up by manifest-registered receivers)
        // AND explicit broadcast if we know the target component (optional, but receiver is usually dynamic in React apps)
        sendBroadcast(intent)
        
        // Also try to notify the MainActivity directly if it's running but receiver missed it
        // This relies on the BroadcastReceiver in MainActivity
    }

    override fun onDestroy() {
        Log.d(TAG, "Service Destroyed")
        isRunning = false
        
        // Cancel alarm
        val alarmManager = getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val intent = Intent(this, ProactiveBackgroundService::class.java).apply {
            action = ACTION_CHECK
        }
        val pendingIntent = PendingIntent.getService(
            this,
            ALARM_REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        alarmManager.cancel(pendingIntent)
        
        super.onDestroy()
    }

    override fun onBind(intent: Intent): IBinder? {
        return null
    }
}
