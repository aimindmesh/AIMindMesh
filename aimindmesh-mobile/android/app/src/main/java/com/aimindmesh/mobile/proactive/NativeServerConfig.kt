package com.aimindmesh.mobile.proactive

import android.content.Context
import com.aimindmesh.mobile.security.SecureStorageManager

/**
 * Server settings the background worker needs, pushed by the JS app (ProactivePlugin.syncServerConfig):
 * the app keeps them in WebView localStorage, which native code cannot read.
 *
 * The API key is read from the Keystore-backed secret store (secret id
 * "aimindmesh-server-settings.apiKey"). Only when encryption is unavailable does the app
 * pass it here, stored as plainly as it already is in localStorage.
 */
data class ServerConfig(
    val enabled: Boolean,
    val serverUrl: String,
    val deliveryMode: String,
    val deviceId: String,
    val apiKey: String,
) {
    val isContextual get() = deliveryMode == "CONTEXTUAL"
}

object NativeServerConfig {
    private const val PREFS = "aimindmesh_native_server_config"
    const val API_KEY_SECRET_ID = "aimindmesh-server-settings.apiKey"

    fun save(context: Context, enabled: Boolean, serverUrl: String, deliveryMode: String, deviceId: String, plainApiKey: String?) {
        val editor = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean("enabled", enabled)
            .putString("serverUrl", serverUrl.trimEnd('/'))
            .putString("deliveryMode", deliveryMode)
            .putString("deviceId", deviceId)
        if (plainApiKey != null) editor.putString("plainApiKey", plainApiKey) else editor.remove("plainApiKey")
        editor.apply()
    }

    fun load(context: Context): ServerConfig {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val secureKey = if (SecureStorageManager.currentMode(context) == SecureStorageManager.Mode.ENCRYPTED) {
            SecureStorageManager.getApiKey(context, API_KEY_SECRET_ID)
        } else null
        return ServerConfig(
            enabled = prefs.getBoolean("enabled", false),
            serverUrl = prefs.getString("serverUrl", "") ?: "",
            deliveryMode = prefs.getString("deliveryMode", "PUSH") ?: "PUSH",
            deviceId = prefs.getString("deviceId", "") ?: "",
            apiKey = secureKey ?: prefs.getString("plainApiKey", "") ?: "",
        )
    }
}
