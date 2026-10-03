package com.aimindmesh.mobile.proactive

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/** One unique periodic ProactiveWorker, every 15 minutes (the WorkManager minimum). */
object ProactiveScheduler {
    private const val TAG = "ProactiveScheduler"
    private const val WORK_NAME = "aimindmesh-proactive"

    /** `enabled` of the proactive settings the app stores via ProactivePlugin.updateSettings (default true). */
    fun isEnabled(context: Context): Boolean {
        val json = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
            .getString("proactive-settings", null) ?: return true
        return try {
            org.json.JSONObject(json).optBoolean("enabled", true)
        } catch (e: Exception) {
            true
        }
    }

    fun schedule(context: Context) {
        cancelLegacyAlarm(context)
        // Network only matters when the worker polls the server (CONTEXTUAL mode)
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(
                if (NativeServerConfig.load(context).isContextual) NetworkType.CONNECTED else NetworkType.NOT_REQUIRED
            )
            .build()
        val request = PeriodicWorkRequestBuilder<ProactiveWorker>(15, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .build()
        WorkManager.getInstance(context)
            .enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, request)
        Log.d(TAG, "Proactive work scheduled")
    }

    fun cancel(context: Context) {
        cancelLegacyAlarm(context)
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
        Log.d(TAG, "Proactive work cancelled")
    }

    /** Alarm left by ProactiveBackgroundService (removed): it targets a service that no longer exists. */
    private fun cancelLegacyAlarm(context: Context) {
        val intent = Intent("com.aimindmesh.mobile.proactive.ACTION_CHECK").setComponent(
            ComponentName(context.packageName, "com.aimindmesh.mobile.proactive.ProactiveBackgroundService")
        )
        val pending = PendingIntent.getService(
            context, 1001, intent, PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
        ) ?: return
        (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(pending)
        pending.cancel()
    }
}
