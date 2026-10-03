package com.aimindmesh.mobile.proactive

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Periodic proactive check (WorkManager, ~15 minutes, Doze-aware): contextual delivery of
 * server insights, then a `proactiveCheck` event for the JS app if it is alive.
 * Replaces ProactiveBackgroundService, which Android 8+ stopped about a minute after the
 * app went to background.
 */
class ProactiveWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val context = applicationContext
        try {
            val config = NativeServerConfig.load(context)
            val score = AvailabilityScoreCalculator(context).calculateScore()
            if (DeliveryClient.shouldPoll(config, score, DeliveryClient.notificationsAllowed(context))) {
                val insights = withContext(Dispatchers.IO) { DeliveryClient.fetchPending(config) }
                if (insights.isNotEmpty()) {
                    Log.i(TAG, "Delivering ${insights.size} pending insight(s)")
                    DeliveryClient.notify(context, insights)
                }
            }
        } catch (e: Exception) {
            // Never retried with backoff: the next periodic run is the retry
            Log.w(TAG, "Contextual delivery failed", e)
        }
        ProactiveEvents.emitCheck()
        return Result.success()
    }

    companion object {
        private const val TAG = "ProactiveWorker"
    }
}
