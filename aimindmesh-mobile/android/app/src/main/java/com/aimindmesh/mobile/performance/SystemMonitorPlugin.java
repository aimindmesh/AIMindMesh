package com.aimindmesh.mobile.performance;

import android.app.ActivityManager;
import android.content.Context;
import android.os.Debug;
import android.os.Process;
import android.os.SystemClock;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.FileReader;
import java.io.IOException;

@CapacitorPlugin(name = "SystemMonitor")
public class SystemMonitorPlugin extends Plugin {

    private long lastCpuTime = 0;
    private long lastSampleTime = 0;

    @PluginMethod
    public void getStats(PluginCall call) {
        JSObject ret = new JSObject();
        Context context = getContext();

        // RAM Usage
        ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
        ActivityManager activityManager = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        activityManager.getMemoryInfo(mi);

        JSObject ram = new JSObject();
        ram.put("total", mi.totalMem);
        ram.put("available", mi.availMem);
        ram.put("used", mi.totalMem - mi.availMem);
        ram.put("threshold", mi.threshold);
        ram.put("lowMemory", mi.lowMemory);

        // App Memory Usage (PSS)
        Debug.MemoryInfo[] memoryInfos = activityManager.getProcessMemoryInfo(new int[] { Process.myPid() });
        long appUsed = 0;
        if (memoryInfos.length > 0) {
            appUsed = memoryInfos[0].getTotalPss() * 1024L; // KB to Bytes
        }
        ram.put("appUsed", appUsed);

        ret.put("ram", ram);

        // CPU Usage (App specific)
        double cpuUsage = 0;
        long currentCpuTime = Process.getElapsedCpuTime();
        long currentSampleTime = SystemClock.elapsedRealtime();

        if (lastSampleTime > 0) {
            long sampleDelta = currentSampleTime - lastSampleTime;
            long cpuDelta = currentCpuTime - lastCpuTime;

            if (sampleDelta > 0) {
                // cpuDelta is in ms (from Process.getElapsedCpuTime doc: "Returns the number of
                // milliseconds..."),
                // sampleDelta is in ms.
                // We want percentage relative to 1 core first?
                // Actually Process.getElapsedCpuTime() returns milliseconds this process has
                // run.
                // Usage % = (cpuDelta / sampleDelta) * 100.
                // Note: This can exceed 100% on multi-core systems if the app is
                // multi-threaded.
                // To normalize to 0-100% of TOTAL device capacity, we should divide by number
                // of processors.
                // However, users usually prefer "System Monitor" style 0-100% per core or
                // Total.
                // Let's normalize by core count to match "System CPU" feel.
                int numCores = Runtime.getRuntime().availableProcessors();
                if (numCores > 0) {
                    cpuUsage = (double) cpuDelta / (double) sampleDelta * 100.0 / (double) numCores;
                }
            }
        }

        lastCpuTime = currentCpuTime;
        lastSampleTime = currentSampleTime;

        ret.put("cpu", cpuUsage);

        // GPU Usage
        ret.put("gpu", getGpuUsage());

        call.resolve(ret);
    }

    private double getGpuUsage() {
        // Try Adreno path
        try {
            // Content is usually "usage_cycles total_cycles" e.g., "10000 500000"
            // or just a single utilization number on some drivers
            String content = readFileOneLine("/sys/class/kgsl/kgsl-3d0/gpubusy");
            if (content != null && !content.isEmpty()) {
                String[] parts = content.trim().split("\\s+");
                if (parts.length >= 2) {
                    long used = Long.parseLong(parts[0]);
                    long total = Long.parseLong(parts[1]);
                    if (total > 0) {
                        return (double) used / (double) total * 100.0;
                    }
                }
            }
        } catch (Exception ignored) {
        }

        // Try Mali path
        try {
            // Content is usually utilization (0-255 or 0-100). Assuming 0-100 typically or
            // 0-255 need check.
            // On many devices it is 0-255. Let's assume safely.
            // Actually standard Mali util is often just load.
            String content = readFileOneLine("/sys/class/mali/mali_gpu/utilization");
            if (content != null && !content.isEmpty()) {
                // Often looks like "Utilization: 20%" or just number
                // Let's try parsing just the first number found
                return Double.parseDouble(content.replaceAll("[^0-9]", ""));
            }
        } catch (Exception ignored) {
        }

        // Fallback or unreadable
        return 0;
    }

    private String readFileOneLine(String path) {
        try (BufferedReader reader = new BufferedReader(new FileReader(path))) {
            return reader.readLine();
        } catch (IOException e) {
            return null;
        }
    }
}
