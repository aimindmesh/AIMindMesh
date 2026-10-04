package com.aimindmesh.mobile.utils;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Lets the web layer wait until the bundled models are unpacked before loading them. */
@CapacitorPlugin(name = "BundledModels")
public class BundledModelsPlugin extends Plugin {

    /** { status: 'not_started' | 'running' | 'ready' | 'failed', error?: string } */
    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("status", ModelAssetManager.getStatus().name().toLowerCase(java.util.Locale.ROOT));
        String error = ModelAssetManager.getLastError();
        if (error != null) {
            ret.put("error", error);
        }
        call.resolve(ret);
    }
}
