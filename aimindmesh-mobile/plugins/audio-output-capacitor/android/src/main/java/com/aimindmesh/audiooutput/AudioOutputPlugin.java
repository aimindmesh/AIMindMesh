package com.aimindmesh.audiooutput;

import android.content.Context;
import android.media.AudioManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import android.util.Log;

@CapacitorPlugin(name = "AudioOutput")
public class AudioOutputPlugin extends Plugin {
    private static final String TAG = "AudioOutputPlugin";
    private AudioManager audioManager;

    @Override
    public void load() {
        super.load();
        Context context = getContext();
        audioManager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        Log.d(TAG, "AudioOutputPlugin loaded");
    }

    @PluginMethod
    public void setSpeakerphoneOn(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled", false);

        if (audioManager == null) {
            call.reject("AudioManager not available");
            return;
        }

        try {
            // Set speakerphone mode
            audioManager.setSpeakerphoneOn(enabled);

            // Also set audio mode to ensure it works correctly
            if (enabled) {
                audioManager.setMode(AudioManager.MODE_NORMAL);
            } else {
                audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
            }

            Log.d(TAG, "Speakerphone set to: " + enabled);

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("enabled", enabled);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Error setting speakerphone", e);
            call.reject("Failed to set speakerphone: " + e.getMessage());
        }
    }

    @PluginMethod
    public void getSpeakerphoneStatus(PluginCall call) {
        if (audioManager == null) {
            call.reject("AudioManager not available");
            return;
        }

        try {
            boolean isOn = audioManager.isSpeakerphoneOn();
            Log.d(TAG, "Speakerphone status: " + isOn);

            JSObject ret = new JSObject();
            ret.put("enabled", isOn);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Error getting speakerphone status", e);
            call.reject("Failed to get speakerphone status: " + e.getMessage());
        }
    }
}
