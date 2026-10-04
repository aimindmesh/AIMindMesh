package com.aimindmesh.mobile.proactive

import android.content.Context
import org.json.JSONObject
import java.util.Calendar

/**
 * The proactive quiet hours the app stores (CapacitorStorage / "proactive-settings", saved
 * by ProactivePlugin.updateSettings): nothing reaches the user in them, natively either.
 */
object QuietHours {
    private const val PREFS = "CapacitorStorage"
    private const val KEY = "proactive-settings"

    /** An hour setting: the app stores numbers (22), older versions "22:00" */
    private fun hourOf(value: Any?, fallback: Double): Double = when (value) {
        is Number -> value.toDouble()
        is String -> value.split(":").let { parts ->
            val h = parts.getOrNull(0)?.toDoubleOrNull() ?: return fallback
            h + (parts.getOrNull(1)?.toDoubleOrNull() ?: 0.0) / 60
        }
        else -> fallback
    }

    /** Pure decision, unit tested: `hour` is the fractional local hour (e.g. 22.5). */
    fun isQuiet(settingsJson: String?, hour: Double): Boolean {
        if (settingsJson.isNullOrBlank()) return false
        val quiet = try {
            JSONObject(settingsJson).optJSONObject("quietHours")
        } catch (e: Exception) {
            null
        } ?: return false
        if (!quiet.optBoolean("enabled", false)) return false
        val start = hourOf(quiet.opt("start"), 22.0)
        val end = hourOf(quiet.opt("end"), 7.0)
        return if (start > end) hour >= start || hour < end else hour >= start && hour < end
    }

    fun isQuietNow(context: Context): Boolean {
        val json = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)
        val now = Calendar.getInstance()
        return isQuiet(json, now.get(Calendar.HOUR_OF_DAY) + now.get(Calendar.MINUTE) / 60.0)
    }
}
