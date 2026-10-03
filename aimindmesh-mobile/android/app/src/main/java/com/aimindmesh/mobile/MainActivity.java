package com.aimindmesh.mobile;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.PermissionRequest;

import org.json.JSONObject;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
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
import com.aimindmesh.mobile.meeting.MeetingExportPlugin;
import com.aimindmesh.fcm.FCMCapacitorPlugin;
import android.content.Context;

public class MainActivity extends BridgeActivity {

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
        registerPlugin(com.aimindmesh.mobile.genie.GeniePlugin.class);
        registerPlugin(com.aimindmesh.mobile.sd.SDPlugin.class);

        super.onCreate(savedInstanceState);

        // API keys are moved to the Android Keystore by the JS secret store (secretStore.ts)

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

        // Periodic WorkManager job (survives background limits, unlike the old service)
        try {
            if (proactiveEnabled) {
                com.aimindmesh.mobile.proactive.ProactiveScheduler.INSTANCE.schedule(this);
            } else {
                com.aimindmesh.mobile.proactive.ProactiveScheduler.INSTANCE.cancel(this);
            }
        } catch (Exception e) {
            android.util.Log.w("ProactiveDebug", "Proactive scheduling failed", e);
        }

        // Capacitor's client stays in charge (runtime RECORD_AUDIO/CAMERA requests, file chooser,
        // JS dialogs): only the origin check is added in front of its permission handling
        getBridge().getWebView().setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                // Grant mic/camera only to the bundled app (served from localhost), never to navigated pages
                Uri origin = request.getOrigin();
                boolean isAppOrigin = origin != null && "localhost".equals(origin.getHost());
                if (isAppOrigin) {
                    super.onPermissionRequest(request);
                } else {
                    runOnUiThread(request::deny);
                }
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
        // A recreated activity (savedInstanceState) must not reopen voice mode
        if (savedInstanceState == null) handleAssistantIntent(getIntent());

    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleWidgetIntent(intent);
        handleShortcutIntent(intent);
        handleAssistantIntent(intent);
    }

    /**
     * Opened as the assistant (ACTION_ASSIST, or AssistantSession after the wake word):
     * the web app opens voice mode. The request is kept until JS reads it, since on a cold
     * start the event below fires before the app's listener exists.
     */
    private void handleAssistantIntent(Intent intent) {
        if (intent == null)
            return;

        boolean assist = Intent.ACTION_ASSIST.equals(intent.getAction())
                || intent.getBooleanExtra("wakeWordDetected", false);
        if (!assist)
            return;

        PerformancePlugin.setPendingLaunchAction("voice");
        String jsCode = "window.dispatchEvent(new CustomEvent('assistantLaunch'));";
        getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(jsCode, null));
    }

    private void handleWidgetIntent(Intent intent) {
        if (intent == null)
            return;

        Uri data = intent.getData();
        if (data != null && SCHEME_COMPANION.equals(data.getScheme())) {
            String host = data.getHost();
            if (host != null) {
                // Pass the widget action to the web app via JavaScript
                // JSONObject.quote escapes the value: intent data must never be able to break out into JS
                String jsCode = "window.dispatchEvent(new CustomEvent('widgetAction', { detail: " + JSONObject.quote(host) + " }));";
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
            // JSONObject.quote escapes the value: the exported activity accepts this extra from any app
            String jsCode = "window.dispatchEvent(new CustomEvent('shortcutAction', { detail: " + JSONObject.quote(route) + " }));";
            getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(jsCode, null));

            // Also notify Android Auto Plugin if we want the car screen to sync
            AndroidAutoPlugin.setInitialRoute(route);
        }
    }

}
