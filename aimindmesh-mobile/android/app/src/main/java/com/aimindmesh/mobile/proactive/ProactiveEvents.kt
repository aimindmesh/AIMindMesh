package com.aimindmesh.mobile.proactive

/**
 * Worker → WebView bridge: ProactivePlugin registers a sink while the app is alive and
 * turns each check into a `proactiveCheck` window event (replaces the implicit broadcast,
 * which Android 8+ does not deliver to manifest receivers anyway).
 */
object ProactiveEvents {
    @Volatile
    var sink: ((timestamp: Long) -> Unit)? = null

    fun emitCheck(timestamp: Long = System.currentTimeMillis()) {
        sink?.invoke(timestamp)
    }
}
