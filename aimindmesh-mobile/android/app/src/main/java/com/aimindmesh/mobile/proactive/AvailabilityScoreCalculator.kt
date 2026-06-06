package com.aimindmesh.mobile.proactive

import android.content.Context
import android.media.AudioManager
import android.os.BatteryManager
import android.os.PowerManager
import android.util.Log

/**
 * Calculates a score (0-100) representing how "available" the user is.
 * High score means the user is likely not busy or focusing on another intense task.
 */
class AvailabilityScoreCalculator(private val context: Context) {

    private val TAG = "AvailabilityScore"

    fun calculateScore(): Int {
        var score = 50 // Start at baseline half

        // 1. Screen State (PowerManager)
        val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        val isScreenOn = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.KITKAT_WATCH) {
            powerManager.isInteractive
        } else {
            powerManager.isScreenOn
        }

        if (isScreenOn) {
            score -= 20 // Active usage lowers availability
            Log.d(TAG, "Screen is ON: -20")
        } else {
            score += 20 // Locked device is good for proactive delivery
            Log.d(TAG, "Screen is OFF: +20")
        }

        // 2. Audio focus / Playing state
        val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        if (audioManager.isMusicActive) {
            score -= 30 // User is listening to something, don't interrupt
            Log.d(TAG, "Music is ACTIVE: -30")
        } else {
            score += 10
            Log.d(TAG, "Music is SILENT: +10")
        }

        // 3. Battery status
        val batteryManager = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        val status = batteryManager.getIntProperty(BatteryManager.BATTERY_PROPERTY_STATUS)
        val isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING || 
                         status == BatteryManager.BATTERY_STATUS_FULL
        
        if (isCharging) {
            score += 15 // Charging usually means stationary/safe
            Log.d(TAG, "Charging: +15")
        }

        // 4. DND Mode (Zen Mode)
        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
            val filter = notificationManager.currentInterruptionFilter
            if (filter != android.app.NotificationManager.INTERRUPTION_FILTER_ALL) {
                score -= 40 // DND means explicitly "don't bother me"
                Log.d(TAG, "DND Active: -40")
            }
        }

        // Clamp 0-100
        val finalScore = score.coerceIn(0, 100)
        Log.d(TAG, "Final Availability Score: $finalScore")
        return finalScore
    }
}
