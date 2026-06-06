package com.aimindmesh.mobile.performance;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Performance")
public class PerformancePlugin extends Plugin {

    private static final String PREFS_NAME = "PerformancePrefs";
    private static final String KEY_KEEP_ALIVE = "keepAliveEnabled";

    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Intent intent = new Intent();
            String packageName = getContext().getPackageName();
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);

            if (pm != null && !pm.isIgnoringBatteryOptimizations(packageName)) {
                intent.setAction(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                intent.setData(Uri.parse("package:" + packageName));
                getContext().startActivity(intent);
                call.resolve();
            } else {
                call.resolve(new JSObject().put("message", "Already ignoring optimizations"));
            }
        } else {
            call.resolve();
        }
    }

    @PluginMethod
    public void isIgnoringBatteryOptimizations(PluginCall call) {
        boolean isIgnoring = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            String packageName = getContext().getPackageName();
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                isIgnoring = pm.isIgnoringBatteryOptimizations(packageName);
            }
        }
        call.resolve(new JSObject().put("isIgnoring", isIgnoring));
    }

    @PluginMethod
    public void startKeepAlive(PluginCall call) {
        android.util.Log.d("KeepAliveDebug", "PerformancePlugin startKeepAlive called");
        // Save preference
        getContext().getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(KEY_KEEP_ALIVE, true)
                .apply();

        Intent intent = new Intent(getContext(), KeepAliveService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void stopKeepAlive(PluginCall call) {
        android.util.Log.d("KeepAliveDebug", "PerformancePlugin stopKeepAlive called");
        // Save preference
        getContext().getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(KEY_KEEP_ALIVE, false)
                .apply();

        Intent intent = new Intent(getContext(), KeepAliveService.class);
        getContext().stopService(intent);
        call.resolve();
    }

    @PluginMethod
    public void getThermalStatus(PluginCall call) {
        JSObject statusObj = new JSObject();

        // Read CPU temperature from thermal zones
        float temp = readCpuTemperature();
        statusObj.put("cpuTempCelsius", temp);
        statusObj.put("thermalTier", classifyThermalTier(temp));

        // Thermal headroom (API 29+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    float headroom = pm.getThermalHeadroom(5); // forecast 5 seconds ahead
                    statusObj.put("headroom", headroom);
                }
            } catch (Exception e) {
                statusObj.put("headroom", -1f);
            }
        }

        call.resolve(statusObj);
    }

    private float readCpuTemperature() {
        String[] paths = {
                "/sys/class/thermal/thermal_zone0/temp",
                "/sys/class/thermal/thermal_zone1/temp",
                "/sys/devices/virtual/thermal/thermal_zone0/temp"
        };
        for (String path : paths) {
            try {
                java.io.BufferedReader reader = new java.io.BufferedReader(
                        new java.io.FileReader(path));
                String line = reader.readLine();
                reader.close();
                if (line != null) {
                    float raw = Float.parseFloat(line.trim());
                    // Most devices report in millidegrees Celsius
                    return raw > 1000 ? raw / 1000f : raw;
                }
            } catch (Exception ignored) {
            }
        }
        return -1f; // Unknown
    }

    private String classifyThermalTier(float temp) {
        if (temp < 0)
            return "UNKNOWN";
        if (temp < 38f)
            return "NORMAL";
        if (temp < 42f)
            return "WARM";
        if (temp < 47f)
            return "HOT";
        if (temp < 52f)
            return "VERY_HOT";
        return "CRITICAL";
    }
}
