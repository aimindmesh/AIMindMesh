package com.aimindmesh.mobile.recording;

import android.util.Log;
import android.view.WindowManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Lets the web layer keep the app running while it post-processes a meeting
 * (see ProcessingService). Best effort: if Android refuses the foreground service, the work
 * still runs while the app stays visible.
 *
 * The screen is also kept on meanwhile: Android runs apps without a visible window on its slow
 * cores (measured ~6x slower on a Galaxy Z Fold5), so letting the phone lock itself would make
 * the transcript take much longer. Leaving the app is still safe, just slower.
 */
@CapacitorPlugin(name = "BackgroundWork")
public class BackgroundWorkPlugin extends Plugin {
    private static final String TAG = "BackgroundWorkPlugin";
    private boolean running = false;

    /** { kind: 'transcribe' | 'speakers' } */
    @PluginMethod
    public void start(PluginCall call) {
        try {
            ProcessingService.startOrUpdate(getContext(), call.getString("kind", "transcribe"), -1);
            running = true;
            setKeepScreenOn(true);
        } catch (Exception e) {
            Log.w(TAG, "Cannot start the processing service", e);
        }
        call.resolve();
    }

    /** { kind, percent: 0-100 } */
    @PluginMethod
    public void progress(PluginCall call) {
        if (running) {
            ProcessingService.notifyProgress(getContext(), call.getString("kind", "transcribe"),
                    call.getInt("percent", 0));
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        running = false;
        ProcessingService.stop(getContext());
        setKeepScreenOn(false);
        call.resolve();
    }

    private void setKeepScreenOn(boolean on) {
        if (getActivity() == null) {
            return;
        }
        getActivity().runOnUiThread(() -> {
            if (on) {
                getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            } else {
                getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
        });
    }
}
