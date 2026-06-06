package com.aimindmesh.mobile;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;

import com.getcapacitor.BridgeActivity;
import com.aimindmesh.mobile.litert.LiteRTPlugin;
import com.aimindmesh.llama.LlamaCppPlugin;

import com.aimindmesh.whisper.WhisperPlugin;
import com.aimindmesh.piper.PiperPlugin;
import com.aimindmesh.vad.VADPlugin;
import com.aimindmesh.mobile.performance.PerformancePlugin;
import com.aimindmesh.mobile.performance.SystemMonitorPlugin;
import com.aimindmesh.auto.AndroidAutoPlugin;
import com.aimindmesh.mobile.audio.AudioPlaybackPlugin;
import com.aimindmesh.mobile.security.SecureStoragePlugin;
import com.aimindmesh.mobile.security.ApiKeyMigration;
import com.aimindmesh.mobile.meeting.MeetingExportPlugin;
import com.aimindmesh.fcm.FCMCapacitorPlugin;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.IntentFilter;

public class MainActivity extends BridgeActivity {

    private final BroadcastReceiver proactiveReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            long timestamp = intent.getLongExtra("timestamp", 0);
            String jsCode = "window.dispatchEvent(new CustomEvent('proactiveCheck', { detail: { timestamp: " + timestamp
                    + " } }));";
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(jsCode, null));
            }
        }
    };

    private static final String SCHEME_COMPANION = "companion";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register plugins before super.onCreate
        registerPlugin(LiteRTPlugin.class);
        registerPlugin(AudioConverter.class);
        registerPlugin(LlamaCppPlugin.class);

        registerPlugin(WhisperPlugin.class);
        registerPlugin(PiperPlugin.class);
        registerPlugin(VADPlugin.class);
        registerPlugin(com.aimindmesh.mobile.voxtral.VoxtralPlugin.class);
        registerPlugin(PerformancePlugin.class);
        registerPlugin(SystemMonitorPlugin.class); // Added SystemMonitorPlugin
        registerPlugin(AndroidAutoPlugin.class);
        registerPlugin(AudioPlaybackPlugin.class);
        registerPlugin(SecureStoragePlugin.class);
        registerPlugin(MeetingExportPlugin.class);
        registerPlugin(com.aimindmesh.mobile.proactive.ProactivePlugin.class);
        registerPlugin(FCMCapacitorPlugin.class);
        registerPlugin(com.aimindmesh.mobile.tts.kokoro.KokoroTTSPlugin.class);

        super.onCreate(savedInstanceState);

        // Migrate API keys from plain-text SharedPreferences to Android Keystore
        ApiKeyMigration.INSTANCE.migrateIfNeeded(this);

        // Check for Keep Alive preference and start service if enabled
        android.util.Log.d("KeepAliveDebug", "MainActivity onCreate called");
        android.content.SharedPreferences prefs = getSharedPreferences("PerformancePrefs",
                android.content.Context.MODE_PRIVATE);
        boolean keepAliveEnabled = prefs.getBoolean("keepAliveEnabled", false);
        android.util.Log.d("KeepAliveDebug", "keepAliveEnabled preference: " + keepAliveEnabled);

        if (keepAliveEnabled) {
            android.util.Log.d("KeepAliveDebug", "Attempting to start KeepAliveService");
            Intent serviceIntent = new Intent(this, com.aimindmesh.mobile.performance.KeepAliveService.class);
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent);
            } else {
                startService(serviceIntent);
            }
        } else {
            android.util.Log.d("KeepAliveDebug", "KeepAliveService not enabled");
        }

        // Check for Proactive Assistant preference and start service if enabled
        android.util.Log.d("ProactiveDebug", "Checking proactive settings");
        android.content.SharedPreferences appPrefs = getSharedPreferences("CapacitorStorage",
                android.content.Context.MODE_PRIVATE);
        String proactiveSettingsJson = appPrefs.getString("proactive-settings", null);

        boolean proactiveEnabled = true; // default to enabled
        if (proactiveSettingsJson != null) {
            try {
                org.json.JSONObject settings = new org.json.JSONObject(proactiveSettingsJson);
                proactiveEnabled = settings.optBoolean("enabled", true);
            } catch (org.json.JSONException e) {
                android.util.Log.e("ProactiveDebug", "Failed to parse proactive settings", e);
            }
        }

        android.util.Log.d("ProactiveDebug", "proactiveEnabled: " + proactiveEnabled);

        if (proactiveEnabled) {
            android.util.Log.d("ProactiveDebug", "Attempting to start ProactiveBackgroundService");
            Intent proactiveIntent = new Intent(this, com.aimindmesh.mobile.proactive.ProactiveBackgroundService.class);
            startService(proactiveIntent);
        } else {
            android.util.Log.d("ProactiveDebug", "ProactiveBackgroundService not enabled, ensuring it is stopped");
            Intent proactiveIntent = new Intent(this, com.aimindmesh.mobile.proactive.ProactiveBackgroundService.class);
            stopService(proactiveIntent);
        }

        getBridge().getWebView().setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                // Permission granting must be executed on the UI thread.
                runOnUiThread(() -> request.grant(request.getResources()));
            }
        });

        // Settings to reduce log noise
        getBridge().getWebView().setOverScrollMode(android.view.View.OVER_SCROLL_NEVER);
        getBridge().getWebView().setScrollBarStyle(android.view.View.SCROLLBARS_OUTSIDE_OVERLAY);
        getBridge().getWebView().setLayerType(android.view.View.LAYER_TYPE_HARDWARE, null);

        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            getBridge().getWebView().getSettings().setSafeBrowsingEnabled(false);
            getBridge().getWebView().setImportantForAutofill(android.view.View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        }

        // Handle widget intent
        handleWidgetIntent(getIntent());
        // Handle shortcut intent
        handleShortcutIntent(getIntent());

        // Register proactive check receiver
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            registerReceiver(proactiveReceiver, new IntentFilter("com.aimindmesh.PROACTIVE_CHECK"),
                    Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(proactiveReceiver, new IntentFilter("com.aimindmesh.PROACTIVE_CHECK"));
        }

    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleWidgetIntent(intent);
        handleShortcutIntent(intent);
    }

    private void handleWidgetIntent(Intent intent) {
        if (intent == null)
            return;

        Uri data = intent.getData();
        if (data != null && SCHEME_COMPANION.equals(data.getScheme())) {
            String host = data.getHost();
            if (host != null) {
                // Pass the widget action to the web app via JavaScript
                String jsCode = "window.dispatchEvent(new CustomEvent('widgetAction', { detail: '" + host + "' }));";
                getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(jsCode, null));
            }
        }
    }

    private void handleShortcutIntent(Intent intent) {
        if (intent == null)
            return;

        String route = intent.getStringExtra("route");
        if (route != null) {
            // Pass the shortcut action to the web app via JavaScript
            String jsCode = "window.dispatchEvent(new CustomEvent('shortcutAction', { detail: '" + route + "' }));";
            getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(jsCode, null));

            // Also notify Android Auto Plugin if we want the car screen to sync
            AndroidAutoPlugin.setInitialRoute(route);
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        try {
            unregisterReceiver(proactiveReceiver);
        } catch (Exception e) {
            // Ignore
        }
    }

}
