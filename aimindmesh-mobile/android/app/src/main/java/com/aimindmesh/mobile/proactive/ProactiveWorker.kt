package com.aimindmesh.mobile.proactive

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Periodic proactive check (WorkManager, Doze-aware). Delivers the insights the server queued
 * for this device (CONTEXTUAL mode, outside quiet hours, when the user is available), then
 * hands the check to the app when it is alive and waits until the app has handled it.
 * Never retried with backoff: the next periodic run is the retry.
 */
class ProactiveWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val context = applicationContext
        var state: DeviceState? = null
        try {
            val config = NativeServerConfig.load(context)
            state = AvailabilityScoreCalculator(context).measure()
            if (DeliveryClient.shouldPoll(config, state.score, DeliveryClient.notificationsAllowed(context), QuietHours.isQuietNow(context))) {
                val insights = withContext(Dispatchers.IO) { DeliveryClient.fetchPending(config) }
                if (insights.isNotEmpty()) {
                    Log.i(TAG, "Delivering ${insights.size} pending insight(s)")
                    DeliveryClient.notify(context, insights)
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Contextual delivery failed", e)
        }

        // The JS checks (agenda, memory work...) run while this worker keeps the process awake
        val check = ProactiveEvents.emitCheck(state)
        if (check != null && withTimeoutOrNull(ACK_TIMEOUT_MS) { check.done.await() } == null) {
            ProactiveEvents.forget(check.id)
            Log.w(TAG, "The app did not finish the proactive check in time")
        }
        return Result.success()
    }

    companion object {
        private const val TAG = "ProactiveWorker"
        /** Longest wait for the app's check (a background summary with a local model can take a while) */
        private const val ACK_TIMEOUT_MS = 120_000L
    }
}
