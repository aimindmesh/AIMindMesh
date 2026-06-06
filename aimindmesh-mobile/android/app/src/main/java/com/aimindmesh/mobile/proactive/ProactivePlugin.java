package com.aimindmesh.mobile.proactive;

import android.content.Context;
import android.content.Intent;
import android.os.Build;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Proactive")
public class ProactivePlugin extends Plugin {

    @PluginMethod
    public void updateSettings(PluginCall call) {
        String settingsJson = call.getString("settings");
        if (settingsJson != null) {
            getContext().getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
                    .edit()
                    .putString("proactive-settings", settingsJson)
                    .apply();
        }
        call.resolve();
    }

    @PluginMethod
    public void startService(PluginCall call) {
        android.util.Log.d("ProactiveDebug", "ProactivePlugin startService called");
        Intent intent = new Intent(getContext(), ProactiveBackgroundService.class);
        getContext().startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void stopService(PluginCall call) {
        android.util.Log.d("ProactiveDebug", "ProactivePlugin stopService called");
        Intent intent = new Intent(getContext(), ProactiveBackgroundService.class);
        getContext().stopService(intent);
        call.resolve();
    }
}
