package com.aimindmesh.mobile.proactive

import android.app.NotificationManager
import android.content.Context
import android.media.AudioManager
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.util.Log

/** What the device is doing at a proactive check: the JS engine gets it with the check. */
data class DeviceState(
    val screenOn: Boolean,
    val musicActive: Boolean,
    val charging: Boolean,
    /** System Do Not Disturb */
    val dnd: Boolean,
    /** 0-100: how available the user is for a notification */
    val score: Int,
)

/**
 * Calculates a score (0-100) representing how "available" the user is.
 * High score means the user is likely not busy or focusing on another intense task.
 */
class AvailabilityScoreCalculator(private val context: Context) {

    fun measure(): DeviceState {
        val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        val screenOn = powerManager.isInteractive

        val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val musicActive = audioManager.isMusicActive

        val batteryManager = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        val status = batteryManager.getIntProperty(BatteryManager.BATTERY_PROPERTY_STATUS)
        val charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL

        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val filter = notificationManager.currentInterruptionFilter
        // UNKNOWN (filter not readable) is not Do Not Disturb
        val dnd = filter != NotificationManager.INTERRUPTION_FILTER_ALL && filter != NotificationManager.INTERRUPTION_FILTER_UNKNOWN

        val score = scoreOf(screenOn, musicActive, charging, dnd)
        Log.d(TAG, "screenOn=$screenOn music=$musicActive charging=$charging dnd=$dnd -> score $score")
        return DeviceState(screenOn, musicActive, charging, dnd, score)
    }

    fun calculateScore(): Int = measure().score

    companion object {
        private const val TAG = "AvailabilityScore"

        /** Pure scoring, unit tested. */
        fun scoreOf(screenOn: Boolean, musicActive: Boolean, charging: Boolean, dnd: Boolean): Int {
            var score = 50
            score += if (screenOn) -20 else 20 // Locked device is good for proactive delivery
            score += if (musicActive) -30 else 10 // Listening to something: don't interrupt
            if (charging) score += 15 // Charging usually means stationary/safe
            if (dnd) score -= 40 // DND means explicitly "don't bother me"
            return score.coerceIn(0, 100)
        }
    }
}
