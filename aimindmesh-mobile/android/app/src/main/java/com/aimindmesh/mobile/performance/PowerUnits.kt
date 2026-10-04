package com.aimindmesh.mobile.performance

import kotlin.math.abs

/**
 * Battery current as the benchmark needs it. BATTERY_PROPERTY_CURRENT_NOW is in µA by the docs,
 * but some vendors report mA, and the sign convention varies: the benchmark only needs the
 * magnitude of the discharge current, so it is read while not charging.
 */
object PowerUnits {
    /** Below this a µA reading would be under 10 mA: no phone with the screen on draws that little */
    private const val MILLIAMP_CEILING = 10_000L

    /** Current in mA (magnitude), or null when the device does not report it */
    fun currentMa(raw: Long): Double? {
        if (raw == Long.MIN_VALUE || raw == 0L || raw == Long.MAX_VALUE) return null
        val magnitude = abs(raw)
        return if (magnitude < MILLIAMP_CEILING) magnitude.toDouble() else magnitude / 1000.0
    }

    /** Power drawn from the battery in mW, or null (charging, or no current/voltage reading) */
    fun dischargeMw(raw: Long, voltageMv: Int, charging: Boolean): Double? {
        if (charging || voltageMv <= 0) return null
        val ma = currentMa(raw) ?: return null
        return ma * voltageMv / 1000.0
    }
}
