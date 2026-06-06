package com.aimindmesh.mobile;

import android.app.Application;
import android.util.Log;

import com.aimindmesh.mobile.performance.MemoryPressureManager;

/**
 * Custom Application class for AMM Mobile.
 * 
 * Overrides onTrimMemory() to proactively unload models based on
 * memory pressure level BEFORE the system kills the process.
 */
public class MainApplication extends Application {

    private static final String TAG = "MainApplication";

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "MainApplication created");
    }

    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        MemoryPressureManager.handleTrimMemory(level, getApplicationContext());
    }
}
