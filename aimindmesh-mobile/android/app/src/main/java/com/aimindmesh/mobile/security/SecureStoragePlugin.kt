package com.aimindmesh.mobile.security

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Capacitor plugin bridging the JS secret store (src/services/security/secretStore.ts)
 * to SecureStorageManager. Keys are the secret ids used by the app, e.g.
 * "gemini-api-key" or "aimindmesh-server-settings.apiKey".
 */
@CapacitorPlugin(name = "SecureStorage")
class SecureStoragePlugin : Plugin() {

    /** { encrypted, hardwareBacked }: the JS side migrates secrets only when encrypted */
    @PluginMethod
    fun status(call: PluginCall) {
        val encrypted = SecureStorageManager.currentMode(context) == SecureStorageManager.Mode.ENCRYPTED
        call.resolve(JSObject().apply {
            put("encrypted", encrypted)
            put("hardwareBacked", encrypted && SecureStorageManager.isHardwareBackedKeystoreAvailable(context))
        })
    }

    /** Resolves only when the value was committed and read back. */
    @PluginMethod
    fun set(call: PluginCall) {
        val key   = call.getString("key")   ?: return call.reject("key required")
        val value = call.getString("value") ?: return call.reject("value required")
        if (SecureStorageManager.saveApiKey(context, key, value)) call.resolve()
        else call.reject("write not verified")
    }

    /** { values: { key: string } }: keys without a stored value are left out */
    @PluginMethod
    fun getMany(call: PluginCall) {
        val keys = call.getArray("keys")?.toList<String>() ?: return call.reject("keys required")
        val values = JSObject()
        SecureStorageManager.getMany(context, keys).forEach { (key, value) ->
            if (value != null) values.put(key, value)
        }
        call.resolve(JSObject().apply { put("values", values) })
    }

    @PluginMethod
    fun remove(call: PluginCall) {
        val key = call.getString("key") ?: return call.reject("key required")
        if (SecureStorageManager.deleteApiKey(context, key)) call.resolve()
        else call.reject("remove failed")
    }
}
