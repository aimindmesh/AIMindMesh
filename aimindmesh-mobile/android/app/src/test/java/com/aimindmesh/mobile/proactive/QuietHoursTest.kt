package com.aimindmesh.mobile.proactive

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QuietHoursTest {
    private fun settings(enabled: Boolean, start: String, end: String) =
        """{"enabled":true,"quietHours":{"enabled":$enabled,"start":$start,"end":$end,"allowCritical":true}}"""

    @Test
    fun followsTheAppSettingsAcrossMidnight() {
        val json = settings(true, "22", "7")
        assertTrue(QuietHours.isQuiet(json, 23.5))
        assertTrue(QuietHours.isQuiet(json, 3.0))
        assertFalse(QuietHours.isQuiet(json, 7.0))
        assertFalse(QuietHours.isQuiet(json, 12.0))
    }

    @Test
    fun readsOlderHourStringsAndSameDayWindows() {
        val json = settings(true, "\"09:30\"", "\"17:00\"")
        assertTrue(QuietHours.isQuiet(json, 9.5))
        assertFalse(QuietHours.isQuiet(json, 9.0))
        assertFalse(QuietHours.isQuiet(json, 17.0))
    }

    @Test
    fun isNeverQuietWhenOffOrUnknown() {
        assertFalse(QuietHours.isQuiet(settings(false, "22", "7"), 23.0))
        assertFalse(QuietHours.isQuiet(null, 23.0))
        assertFalse(QuietHours.isQuiet("not json", 23.0))
        assertFalse(QuietHours.isQuiet("{}", 23.0))
    }

    @Test
    fun scoresTheNightstandBelowAPhoneInUseWithDnd() {
        // Screen off, charging, silent: high availability (quiet hours keep it from notifying)
        assertEquals(95, AvailabilityScoreCalculator.scoreOf(screenOn = false, musicActive = false, charging = true, dnd = false))
        assertEquals(0, AvailabilityScoreCalculator.scoreOf(screenOn = true, musicActive = true, charging = false, dnd = true))
    }
}
