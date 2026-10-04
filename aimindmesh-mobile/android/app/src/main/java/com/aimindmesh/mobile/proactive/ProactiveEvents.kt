package com.aimindmesh.mobile.proactive

import kotlinx.coroutines.CompletableDeferred
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/** A check handed to the WebView: `done` completes when JS has handled it. */
class PendingCheck(val id: String, val done: CompletableDeferred<Unit>)

/**
 * Worker → WebView bridge: ProactivePlugin registers a sink while the app is alive and
 * turns each check into a `proactiveCheck` window event (replaces the implicit broadcast,
 * which Android 8+ does not deliver to manifest receivers anyway). The worker waits for the
 * JS acknowledgement (ProactivePlugin.checkDone), so the process stays awake while JS works.
 */
object ProactiveEvents {
    @Volatile
    var sink: ((checkId: String, timestamp: Long, state: DeviceState?) -> Unit)? = null

    private val pending = ConcurrentHashMap<String, CompletableDeferred<Unit>>()

    /** Null when no app is alive to handle the check. */
    fun emitCheck(state: DeviceState?, timestamp: Long = System.currentTimeMillis()): PendingCheck? {
        val target = sink ?: return null
        val check = PendingCheck(UUID.randomUUID().toString(), CompletableDeferred())
        pending[check.id] = check.done
        target(check.id, timestamp, state)
        return check
    }

    fun acknowledge(checkId: String?) {
        if (checkId != null) pending.remove(checkId)?.complete(Unit)
    }

    /** The worker stopped waiting (timeout) */
    fun forget(checkId: String) {
        pending.remove(checkId)
    }
}
