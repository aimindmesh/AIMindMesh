package com.aimindmesh.mobile.proactive;

import android.content.Context;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JS bridge of the proactive assistant: settings, the periodic ProactiveWorker
 * (start/stop) and the server settings the worker needs.
 */
@CapacitorPlugin(name = "Proactive")
public class ProactivePlugin extends Plugin {

    @Override
    public void load() {
        // Checks run by the worker reach the WebView as `proactiveCheck` window events
        ProactiveEvents.INSTANCE.setSink(timestamp -> {
            if (getBridge() != null && getBridge().getWebView() != null) {
                String js = "window.dispatchEvent(new CustomEvent('proactiveCheck', { detail: { timestamp: " + timestamp + " } }));";
                getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(js, null));
            }
            return kotlin.Unit.INSTANCE;
        });
    }

    @Override
    protected void handleOnDestroy() {
        ProactiveEvents.INSTANCE.setSink(null);
        super.handleOnDestroy();
    }

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
        ProactiveScheduler.INSTANCE.schedule(getContext());
        call.resolve();
    }

    @PluginMethod
    public void stopService(PluginCall call) {
        ProactiveScheduler.INSTANCE.cancel(getContext());
        call.resolve();
    }

    /**
     * { enabled, serverUrl, deliveryMode, deviceId, apiKey? }: apiKey only when the app has no
     * encrypted secret store (otherwise the worker reads it from the Keystore).
     */
    @PluginMethod
    public void syncServerConfig(PluginCall call) {
        NativeServerConfig.INSTANCE.save(
                getContext(),
                Boolean.TRUE.equals(call.getBoolean("enabled", false)),
                call.getString("serverUrl", ""),
                call.getString("deliveryMode", "PUSH"),
                call.getString("deviceId", ""),
                call.getString("apiKey"));
        // The network constraint depends on the delivery mode: refresh the scheduled work
        if (ProactiveScheduler.INSTANCE.isEnabled(getContext())) {
            ProactiveScheduler.INSTANCE.schedule(getContext());
        }
        call.resolve();
    }
}
