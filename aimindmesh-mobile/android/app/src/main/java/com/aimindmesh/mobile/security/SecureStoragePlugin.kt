package com.aimindmesh.mobile.security

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Capacitor plugin bridging JavaScript to SecureStorageManager.
 * Provides encrypted API key CRUD and hardware-backing diagnostics.
 */
@CapacitorPlugin(name = "SecureStorage")
class SecureStoragePlugin : Plugin() {

    @PluginMethod
    fun saveApiKey(call: PluginCall) {
        val key   = call.getString("key")   ?: return call.reject("key required")
        val value = call.getString("value") ?: return call.reject("value required")

        SecureStorageManager.saveApiKey(context, key, value)
        call.resolve()
    }

    @PluginMethod
    fun getApiKey(call: PluginCall) {
        val key = call.getString("key") ?: return call.reject("key required")
        val value = SecureStorageManager.getApiKey(context, key)

        call.resolve(JSObject().apply {
            put("value", value ?: "")
            put("found", value != null)
        })
    }

    @PluginMethod
    fun deleteApiKey(call: PluginCall) {
        val key = call.getString("key") ?: return call.reject("key required")
        SecureStorageManager.deleteApiKey(context, key)
        call.resolve()
    }

    @PluginMethod
    fun deleteAllKeys(call: PluginCall) {
        SecureStorageManager.deleteAllKeys(context)
        call.resolve()
    }

    @PluginMethod
    fun isHardwareBacked(call: PluginCall) {
        val hw = SecureStorageManager.isHardwareBackedKeystoreAvailable()
        call.resolve(JSObject().apply {
            put("hardwareBacked", hw)
        })
    }
}
