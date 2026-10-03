package com.aimindmesh.termux;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Capacitor plugin for executing shell commands in Termux.
 *
 * Commands go through Termux's RUN_COMMAND intent (RunCommandService): another app
 * cannot exec Termux binaries directly (its data dir is private to the Termux uid).
 * Requirements on the device: Termux installed, the com.termux.permission.RUN_COMMAND
 * permission granted to this app, and allow-external-apps=true in ~/.termux/termux.properties.
 */
@CapacitorPlugin(
        name = "Termux",
        permissions = { @Permission(alias = "runCommand", strings = { TermuxPlugin.RUN_COMMAND_PERMISSION }) })
public class TermuxPlugin extends Plugin {

    static final String RUN_COMMAND_PERMISSION = "com.termux.permission.RUN_COMMAND";
    private static final String TERMUX_PACKAGE = "com.termux";
    private static final String TERMUX_API_PACKAGE = "com.termux.api";
    private static final String TERMUX_RUN_COMMAND = "com.termux.RUN_COMMAND";
    private static final String TERMUX_RESULT_ACTION = "com.aimindmesh.termux.RESULT";
    private static final String TERMUX_PREFIX = "/data/data/com.termux/files";
    private static final long DEFAULT_TIMEOUT_MS = 120_000L;
    private static final String SETUP_HINT = "Check that Termux has been opened once, that RUN_COMMAND is allowed for this app "
            + "and that allow-external-apps=true is set in ~/.termux/termux.properties.";

    // Pending calls by request id; the token guards against forged result broadcasts
    private final Map<Integer, PendingCommand> pendingCalls = new ConcurrentHashMap<>();
    private final AtomicInteger requestIdCounter = new AtomicInteger(1000);
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private boolean receiverRegistered = false;

    private static final class PendingCommand {
        final PluginCall call;
        final String token;

        PendingCommand(PluginCall call, String token) {
            this.call = call;
            this.token = token;
        }
    }

    @Override
    public void load() {
        super.load();
        IntentFilter filter = new IntentFilter(TERMUX_RESULT_ACTION);
        // Results arrive through our own PendingIntent, so the receiver never needs to be exported
        if (Build.VERSION.SDK_INT >= 33) {
            getContext().registerReceiver(resultReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            getContext().registerReceiver(resultReceiver, filter);
        }
        receiverRegistered = true;
    }

    private final BroadcastReceiver resultReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            int requestId = intent.getIntExtra("requestId", -1);
            PendingCommand pending = pendingCalls.get(requestId);
            if (pending == null || !pending.token.equals(intent.getStringExtra("token"))) {
                return;
            }
            pendingCalls.remove(requestId);

            // Termux puts the outcome in the "result" bundle (TermuxConstants EXTRA_PLUGIN_RESULT_BUNDLE)
            Bundle result = intent.getBundleExtra("result");
            JSObject ret = new JSObject();
            if (result == null) {
                ret.put("success", false);
                ret.put("stdout", "");
                ret.put("stderr", "Termux returned no result. " + SETUP_HINT);
                ret.put("exitCode", -1);
                pending.call.resolve(ret);
                return;
            }
            String stdout = result.getString("stdout", "");
            String stderr = result.getString("stderr", "");
            int exitCode = result.getInt("exitCode", -1);
            // err is Activity.RESULT_OK (-1) when Termux could run the command
            int err = result.getInt("err", -1);
            String errmsg = result.getString("errmsg", "");
            boolean ran = err == -1;
            if (!ran) {
                stderr = (stderr.isEmpty() ? "" : stderr + "\n") + "Termux error " + err + ": " + errmsg + " " + SETUP_HINT;
            }
            ret.put("success", ran && exitCode == 0);
            ret.put("stdout", stdout);
            ret.put("stderr", stderr);
            ret.put("exitCode", exitCode);
            ret.put("async", true);
            pending.call.resolve(ret);
        }
    };

    @PluginMethod
    public void executeCommand(PluginCall call) {
        String command = call.getString("command");
        if (command == null || command.isEmpty()) {
            call.reject("Command is required");
            return;
        }
        if (!isTermuxInstalled()) {
            resolveFailure(call, "Termux is not installed.");
            return;
        }
        if (getPermissionState("runCommand") != PermissionState.GRANTED) {
            requestPermissionForAlias("runCommand", call, "runCommandPermissionCallback");
            return;
        }
        sendTermuxIntent(call, command);
    }

    @PermissionCallback
    private void runCommandPermissionCallback(PluginCall call) {
        if (getPermissionState("runCommand") == PermissionState.GRANTED) {
            sendTermuxIntent(call, call.getString("command", ""));
        } else {
            resolveFailure(call, "Permission " + RUN_COMMAND_PERMISSION + " was denied. Grant it in the app settings to run Termux commands.");
        }
    }

    private void sendTermuxIntent(PluginCall call, String command) {
        int requestId = requestIdCounter.getAndIncrement();
        String token = UUID.randomUUID().toString();
        try {
            pendingCalls.put(requestId, new PendingCommand(call, token));

            Intent intent = new Intent();
            intent.setClassName(TERMUX_PACKAGE, "com.termux.app.RunCommandService");
            intent.setAction(TERMUX_RUN_COMMAND);
            intent.putExtra("com.termux.RUN_COMMAND_PATH", TERMUX_PREFIX + "/usr/bin/sh");
            intent.putExtra("com.termux.RUN_COMMAND_ARGUMENTS", new String[] { "-c", command });
            intent.putExtra("com.termux.RUN_COMMAND_WORKDIR", TERMUX_PREFIX + "/home");
            // Output is only returned for background commands (no terminal session)
            intent.putExtra("com.termux.RUN_COMMAND_BACKGROUND", true);

            Intent resultIntent = new Intent(TERMUX_RESULT_ACTION);
            resultIntent.setPackage(getContext().getPackageName());
            resultIntent.putExtra("requestId", requestId);
            resultIntent.putExtra("token", token);
            // Mutable: Termux fills in the result bundle
            int flags = PendingIntent.FLAG_ONE_SHOT
                    | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0);
            PendingIntent pendingIntent = PendingIntent.getBroadcast(getContext(), requestId, resultIntent, flags);
            intent.putExtra("com.termux.RUN_COMMAND_PENDING_INTENT", pendingIntent);

            // Termux may not be running: its RunCommandService promotes itself to foreground
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }

            long timeoutMs = call.getLong("timeoutMs", DEFAULT_TIMEOUT_MS);
            mainHandler.postDelayed(() -> {
                PendingCommand expired = pendingCalls.remove(requestId);
                if (expired != null) {
                    resolveFailure(expired.call, "Termux did not answer within " + (timeoutMs / 1000) + "s. " + SETUP_HINT);
                }
            }, timeoutMs);
        } catch (Exception e) {
            pendingCalls.remove(requestId);
            resolveFailure(call, "Failed to launch Termux service: " + e.getMessage() + ". " + SETUP_HINT);
        }
    }

    private void resolveFailure(PluginCall call, String message) {
        JSObject res = new JSObject();
        res.put("success", false);
        res.put("stdout", "");
        res.put("stderr", message);
        res.put("exitCode", -1);
        call.resolve(res);
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", isTermuxInstalled());
        result.put("permissionGranted", getPermissionState("runCommand") == PermissionState.GRANTED);
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

    @Override
    protected void handleOnDestroy() {
        mainHandler.removeCallbacksAndMessages(null);
        for (PendingCommand pending : pendingCalls.values()) {
            resolveFailure(pending.call, "Termux command abandoned: the app is closing.");
        }
        pendingCalls.clear();
        if (receiverRegistered) {
            try {
                getContext().unregisterReceiver(resultReceiver);
            } catch (IllegalArgumentException ignored) {
                // already unregistered
            }
            receiverRegistered = false;
        }
        super.handleOnDestroy();
    }

    private boolean isTermuxInstalled() {
        PackageManager pm = getContext().getPackageManager();
        try {
            pm.getPackageInfo(TERMUX_PACKAGE, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }
}
