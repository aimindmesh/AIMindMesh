package com.aimindmesh.mobile.proactive;

import android.content.Context;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * JS bridge of the proactive assistant: settings, the periodic ProactiveWorker
 * (start/stop) and the server settings the worker needs.
 */
@CapacitorPlugin(name = "Proactive")
public class ProactivePlugin extends Plugin {

    private kotlin.jvm.functions.Function3<String, Long, DeviceState, kotlin.Unit> sink;

    @Override
    public void load() {
        // Checks run by the worker reach the WebView as `proactiveCheck` window events, with the
        // device state; JS answers checkDone(checkId) when it has handled them
        sink = (checkId, timestamp, state) -> {
            if (getBridge() != null && getBridge().getWebView() != null) {
                String js = "window.dispatchEvent(new CustomEvent('proactiveCheck', { detail: " + checkDetail(checkId, timestamp, state) + " }));";
                getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(js, null));
            } else {
                ProactiveEvents.INSTANCE.acknowledge(checkId); // nobody to handle it
            }
            return kotlin.Unit.INSTANCE;
        };
        ProactiveEvents.INSTANCE.setSink(sink);
    }

    /** JSON detail of a check (built with JSONObject: values never break out into JS) */
    private static String checkDetail(String checkId, long timestamp, DeviceState state) {
        JSONObject detail = new JSONObject();
        try {
            detail.put("checkId", checkId);
            detail.put("timestamp", timestamp);
            if (state != null) {
                detail.put("screenOn", state.getScreenOn());
                detail.put("charging", state.getCharging());
                detail.put("dnd", state.getDnd());
                detail.put("score", state.getScore());
            }
        } catch (JSONException e) {
            // Only put() of finite values: cannot happen
        }
        return detail.toString();
    }

    /** The app has handled a `proactiveCheck`: the worker waiting on it may finish */
    @PluginMethod
    public void checkDone(PluginCall call) {
        ProactiveEvents.INSTANCE.acknowledge(call.getString("checkId"));
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        // Only our own sink: a recreated activity may have registered its plugin already
        if (ProactiveEvents.INSTANCE.getSink() == sink) ProactiveEvents.INSTANCE.setSink(null);
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
        call.resolve();
    }
}
