package com.aimindmesh.termux;

import android.content.ComponentName;
import android.content.Intent;
import android.content.IntentFilter;
import android.annotation.SuppressLint;
import android.content.pm.PackageManager;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Capacitor plugin for executing shell commands via Termux:API
 * 
 * Termux:API must be installed on the device for this to work.
 * Uses the termux-api package to execute commands.
 */
@CapacitorPlugin(name = "Termux")
public class TermuxPlugin extends Plugin {

    private static final String TERMUX_PACKAGE = "com.termux";
    private static final String TERMUX_API_PACKAGE = "com.termux.api";
    private static final String TERMUX_RUN_COMMAND = "com.termux.RUN_COMMAND";
    private static final String TERMUX_RESULT_ACTION = "com.aimindmesh.termux.RESULT";

    // Extras for the result intent
    private static final String EXTRA_STDOUT = "com.termux.RUN_COMMAND_STDOUT";
    private static final String EXTRA_STDERR = "com.termux.RUN_COMMAND_STDERR";
    private static final String EXTRA_EXIT_CODE = "com.termux.RUN_COMMAND_EXIT_CODE";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    // Map to store pending calls by request ID
    private final java.util.Map<Integer, PluginCall> pendingCalls = new java.util.concurrent.ConcurrentHashMap<>();
    private final java.util.concurrent.atomic.AtomicInteger requestIdCounter = new java.util.concurrent.atomic.AtomicInteger(
            1000);

    @SuppressLint("UnspecifiedRegisterReceiverFlag")
    @Override
    public void load() {
        super.load();
        // Register broadcast receiver for Termux results
        IntentFilter filter = new IntentFilter(TERMUX_RESULT_ACTION);
        // Android 13+ requires explicit flags for dynamic receivers. Termux results come from another app.
        if (android.os.Build.VERSION.SDK_INT >= 33) { // TIRAMISU
            getContext().registerReceiver(resultReceiver, filter, 0x2); // RECEIVER_EXPORTED
        } else {
            getContext().registerReceiver(resultReceiver, filter);
        }
    }

    private final android.content.BroadcastReceiver resultReceiver = new android.content.BroadcastReceiver() {
        @Override
        public void onReceive(android.content.Context context, Intent intent) {
            int requestId = intent.getIntExtra("requestId", -1);
            if (requestId == -1)
                return;

            PluginCall call = pendingCalls.remove(requestId);
            if (call == null)
                return;

            int exitCode = intent.getIntExtra(EXTRA_EXIT_CODE, -1);
            String stdout = intent.getStringExtra(EXTRA_STDOUT);
            String stderr = intent.getStringExtra(EXTRA_STDERR);

            JSObject result = new JSObject();
            result.put("success", exitCode == 0);
            result.put("stdout", stdout != null ? stdout : "");
            result.put("stderr", stderr != null ? stderr : "");
            result.put("exitCode", exitCode);
            result.put("async", true); // Flag to verify async path was used

            call.resolve(result);
        }
    };

    @PluginMethod
    public void executeCommand(PluginCall call) {
        String command = call.getString("command");
        boolean background = call.getBoolean("background", false);

        if (command == null || command.isEmpty()) {
            call.reject("Command is required");
            return;
        }

        executor.execute(() -> {
            JSObject result = new JSObject();

            try {
                if (!isTermuxInstalled()) {
                    result.put("success", false);
                    result.put("stderr", "Termux is not installed.");
                    mainHandler.post(() -> call.resolve(result));
                    return;
                }

                // Try direct shell execution through Termux's shell binary
                // This is more reliable than Intent-based execution on Android 13+
                String termuxBin = "/data/data/com.termux/files/usr/bin";
                String termuxHome = "/data/data/com.termux/files/home";

                ProcessBuilder pb = new ProcessBuilder(termuxBin + "/sh", "-c", command);
                pb.directory(new java.io.File(termuxHome));
                pb.environment().put("HOME", termuxHome);
                pb.environment().put("PATH", termuxBin + ":" + System.getenv("PATH"));
                pb.environment().put("TERM", "xterm-256color");
                pb.redirectErrorStream(false);

                Process process = pb.start();

                // Read stdout
                StringBuilder stdout = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        stdout.append(line).append("\n");
                    }
                }

                // Read stderr
                StringBuilder stderr = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getErrorStream()))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        stderr.append(line).append("\n");
                    }
                }

                int exitCode = process.waitFor();

                result.put("success", exitCode == 0);
                result.put("stdout", stdout.toString().trim());
                result.put("stderr", stderr.toString().trim());
                result.put("exitCode", exitCode);
                result.put("method", "direct");

                mainHandler.post(() -> call.resolve(result));

            } catch (Exception e) {
                // Direct execution failed, could be permission issue
                // The app may not have access to /data/data/com.termux
                result.put("success", false);
                result.put("stderr", "Command execution failed: " + e.getMessage() +
                        ". Make sure Termux is running and has been opened at least once.");
                result.put("method", "direct_failed");
                mainHandler.post(() -> call.resolve(result));
            }
        });
    }

    private void sendTermuxIntent(PluginCall call, String command, boolean background) {
        try {
            int requestId = requestIdCounter.getAndIncrement();
            pendingCalls.put(requestId, call);

            Intent intent = new Intent();
            intent.setClassName(TERMUX_PACKAGE, "com.termux.app.RunCommandService");
            intent.setAction(TERMUX_RUN_COMMAND);
            intent.putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/usr/bin/sh");
            intent.putExtra("com.termux.RUN_COMMAND_ARGUMENTS", new String[] { "-c", command });
            intent.putExtra("com.termux.RUN_COMMAND_BACKGROUND", background);
            intent.putExtra("com.termux.RUN_COMMAND_WORKDIR", "/data/data/com.termux/files/home");

            // Create PendingIntent for the result
            Intent resultIntent = new Intent(TERMUX_RESULT_ACTION);
            resultIntent.putExtra("requestId", requestId);
            resultIntent.setPackage(getContext().getPackageName()); // Explicitly target our app

            android.app.PendingIntent pendingIntent = android.app.PendingIntent.getBroadcast(
                    getContext(),
                    requestId,
                    resultIntent,
                    android.app.PendingIntent.FLAG_ONE_SHOT | android.app.PendingIntent.FLAG_MUTABLE);

            intent.putExtra("com.termux.RUN_COMMAND_PENDING_INTENT", pendingIntent);

            getContext().startService(intent);
            // Don't resolve here! The receiver will resolve it.

        } catch (Exception e) {
            pendingCalls.remove(requestIdCounter.get() - 1); // Cleanup on failure (approximate)
            JSObject res = new JSObject();
            res.put("success", false);
            res.put("stderr", "Failed to launch Termux service: " + e.getMessage());
            mainHandler.post(() -> call.resolve(res));
        }
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", isTermuxInstalled());
        call.resolve(result);
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("URL is required");
            return;
        }

        try {
            Intent intent = new Intent();
            intent.setComponent(new ComponentName(TERMUX_API_PACKAGE,
                    "com.termux.api.activities.TermuxApiActivity"));
            intent.setAction("com.termux.api.OPEN_URL");
            intent.putExtra("url", url);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to open URL: " + e.getMessage());
        }
    }

    @PluginMethod
    public void showToast(PluginCall call) {
        String message = call.getString("message");
        boolean isShort = call.getBoolean("short", true);

        if (message == null) {
            call.reject("Message is required");
            return;
        }

        try {
            Intent intent = new Intent();
            intent.setComponent(new ComponentName(TERMUX_API_PACKAGE,
                    "com.termux.api.activities.TermuxApiActivity"));
            intent.setAction("com.termux.api.TOAST");
            intent.putExtra("text", message);
            intent.putExtra("short", isShort);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to show toast: " + e.getMessage());
        }
    }

    @PluginMethod
    public void vibrate(PluginCall call) {
        int duration = call.getInt("duration", 500);

        try {
            Intent intent = new Intent();
            intent.setComponent(new ComponentName(TERMUX_API_PACKAGE,
                    "com.termux.api.activities.TermuxApiActivity"));
            intent.setAction("com.termux.api.VIBRATE");
            intent.putExtra("duration", duration);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to vibrate: " + e.getMessage());
        }
    }

    private boolean isTermuxInstalled() {
        PackageManager pm = getContext().getPackageManager();
        try {
            pm.getPackageInfo(TERMUX_PACKAGE, PackageManager.GET_ACTIVITIES);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }
}
