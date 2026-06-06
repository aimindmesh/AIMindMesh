package com.aimindmesh.mobile.performance;

import android.content.ComponentCallbacks2;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Manages model unloading based on Android memory pressure levels.
 * 
 * Called from MainApplication.onTrimMemory() to proactively free memory
 * BEFORE the system kills the process.
 * 
 * Unloading order (least critical first):
 * vision_projector → tts_piper → vad_model → stt_vosk → stt_voxtral →
 * llm_litert → llm_gguf
 */
public class MemoryPressureManager {

    private static final String TAG = "MemoryPressureManager";

    // Broadcast action for JS layer to receive trim events
    public static final String ACTION_TRIM_COMPONENT = "com.aimindmesh.mobile.TRIM_COMPONENT";

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
                    "stt_vosk", "stt_voxtral", "llm_litert"
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
            // System critically low while running
            componentsToUnload = new String[] { "vision_projector", "tts_piper" };
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
    }
}
