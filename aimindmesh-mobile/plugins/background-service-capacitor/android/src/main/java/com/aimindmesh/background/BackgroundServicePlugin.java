package com.aimindmesh.background;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BackgroundService")
public class BackgroundServicePlugin extends Plugin {

    @PluginMethod
    public void startService(PluginCall call) {
        String title = call.getString("title", "AMM Mobile");
        String body = call.getString("body", "Sempre attivo in background");

        Intent intent = new Intent(getContext(), BackgroundService.class);
        intent.putExtra("title", title);
        intent.putExtra("body", body);

        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }

        call.resolve();
    }

    @PluginMethod
    public void stopService(PluginCall call) {
        Intent intent = new Intent(getContext(), BackgroundService.class);
        getContext().stopService(intent);
        call.resolve();
    }

    @PluginMethod
    public void isRunning(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("running", BackgroundService.isRunning);
        call.resolve(ret);
    }
}
