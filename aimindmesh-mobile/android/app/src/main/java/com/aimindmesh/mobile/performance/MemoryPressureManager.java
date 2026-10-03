package com.aimindmesh.mobile.performance;

import android.content.ComponentCallbacks2;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

import com.aimindmesh.mobile.litert.LiteRTPlugin;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Manages model unloading based on Android memory pressure levels.
 *
 * Called from MainApplication.onTrimMemory() to proactively free memory
 * BEFORE the system kills the process.
 *
 * Unloading order (least critical first):
 * vision_projector → tts_piper → vad_model → stt_vosk → stt_voxtral →
 * llm_litert → llm_gguf
 *
 * Each request is broadcast to the app (PerformancePlugin forwards it to JS handlers) and,
 * for components with a native handler registered here, also released natively. A native
 * handler must only free a model when it is idle and the JS side reloads it on demand.
 */
public class MemoryPressureManager {

    private static final String TAG = "MemoryPressureManager";

    // Broadcast action for JS layer to receive trim events
    public static final String ACTION_TRIM_COMPONENT = "com.aimindmesh.mobile.TRIM_COMPONENT";

    private static final Map<String, Runnable> handlers = new ConcurrentHashMap<>();

    static {
        // LiteRT reloads its engine on the next initModel; trimIfIdle never interrupts a generation
        handlers.put("llm_litert", LiteRTPlugin::trimIfIdle);
    }

    /** Lets a plugin release its component under pressure (replaces any previous handler). */
    public static void registerTrimHandler(String component, Runnable handler) {
        handlers.put(component, handler);
    }

    /**
     * Handle onTrimMemory callback with graduated response.
     *
     * @param level   Android ComponentCallbacks2 trim level
     * @param context Application context for broadcasting
     */
    public static void handleTrimMemory(int level, Context context) {
        Log.w(TAG, "onTrimMemory: level=" + level);

        String[] componentsToUnload;

        if (level >= ComponentCallbacks2.TRIM_MEMORY_COMPLETE) {
            // Emergency: unload everything except GGUF (protected by KeepAlive)
            Log.e(TAG, "CRITICAL memory pressure — unloading all non-essential models");
            componentsToUnload = new String[] {
                    "vision_projector", "tts_piper", "vad_model",
                    "stt_vosk", "stt_voxtral", "llm_litert", "heavy_all"
            };
        } else if (level >= ComponentCallbacks2.TRIM_MEMORY_MODERATE) {
            // App in background, moderate risk
            componentsToUnload = new String[] {
                    "vision_projector", "tts_piper", "vad_model", "stt_vosk"
            };
        } else if (level >= ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN) {
            // App went to background
            componentsToUnload = new String[] { "vision_projector" };
        } else if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL) {
            // System critically low while running: heavy models the current feature does not need
            componentsToUnload = new String[] { "vision_projector", "tts_piper", "heavy_idle" };
        } else if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) {
            // System running low
            componentsToUnload = new String[] { "vision_projector" };
        } else {
            componentsToUnload = new String[] {};
        }

        for (String component : componentsToUnload) {
            unloadComponent(component, context);
        }
    }

    private static void unloadComponent(String component, Context context) {
        Log.i(TAG, "Requesting unload: " + component);
        Intent intent = new Intent(ACTION_TRIM_COMPONENT);
        intent.putExtra("component", component);
        intent.setPackage(context.getPackageName());
        context.sendBroadcast(intent);

        Runnable handler = handlers.get(component);
        if (handler == null) return;
        try {
            handler.run();
        } catch (RuntimeException e) {
            Log.w(TAG, "Unload of " + component + " failed", e);
        }
    }
}
