package com.aimindmesh.mobile.security;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.os.Build;
import android.view.WindowManager;

import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * App lock: asks for the fingerprint, face or screen lock PIN before showing the app, and
 * keeps the app's content out of screenshots and the recent apps view (FLAG_SECURE, saved so
 * MainActivity applies it before anything is drawn).
 */
@CapacitorPlugin(name = "AppLock")
public class AppLockPlugin extends Plugin {

    private static final String PREFS = "app_lock";
    private static final String SECURE_SCREEN = "secure_screen";

    /** Called from MainActivity.onCreate: the recent-apps thumbnail never shows the content. */
    public static void applySavedSecureFlag(Activity activity) {
        if (activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(SECURE_SCREEN, false)) {
            activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        }
    }

    private static final int AUTHENTICATORS = BiometricManager.Authenticators.BIOMETRIC_WEAK
            | BiometricManager.Authenticators.DEVICE_CREDENTIAL;

    /** Resolves { available }: false when the phone has no screen lock to verify against. */
    @PluginMethod
    public void isAvailable(PluginCall call) {
        KeyguardManager keyguard = (KeyguardManager) getContext().getSystemService(Context.KEYGUARD_SERVICE);
        JSObject ret = new JSObject();
        ret.put("available", keyguard != null && keyguard.isDeviceSecure());
        call.resolve(ret);
    }

    /** Shows the system authentication; resolves { success } (false when cancelled or failed). */
    @PluginMethod
    public void authenticate(PluginCall call) {
        FragmentActivity activity = getActivity();
        if (activity == null) {
            call.reject("No activity");
            return;
        }
        String title = call.getString("title", "AI Mind Mesh");
        String subtitle = call.getString("subtitle", "");
        activity.runOnUiThread(() -> {
            BiometricPrompt prompt = new BiometricPrompt(activity, ContextCompat.getMainExecutor(activity),
                    new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                            JSObject ret = new JSObject();
                            ret.put("success", true);
                            call.resolve(ret);
                        }

                        @Override
                        public void onAuthenticationError(int errorCode, CharSequence message) {
                            JSObject ret = new JSObject();
                            ret.put("success", false);
                            ret.put("reason", message.toString());
                            call.resolve(ret);
                        }
                    });
            BiometricPrompt.PromptInfo.Builder info = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle(title)
                    .setSubtitle(subtitle);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                info.setAllowedAuthenticators(AUTHENTICATORS);
            } else {
                // Before Android 11 the PIN fallback is requested this way
                info.setDeviceCredentialAllowed(true);
            }
            prompt.authenticate(info.build());
        });
    }

    /** { enabled }: hide the app's content from screenshots and the recent apps view. */
    @PluginMethod
    public void setSecureScreen(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(SECURE_SCREEN, enabled).apply();
        if (getActivity() == null) {
            call.resolve();
            return;
        }
        getActivity().runOnUiThread(() -> {
            if (enabled) {
                getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            } else {
                getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            }
            call.resolve();
        });
    }
}
