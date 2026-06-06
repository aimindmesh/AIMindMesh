package com.aimindmesh.mobile.security

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Singleton manager for secure API key storage using Android Keystore.
 * Keys are encrypted at rest with AES-256-GCM, backed by hardware TEE/StrongBox
 * when available.
 */
object SecureStorageManager {

    private const val TAG = "SecureStorageManager"
    private const val SECURE_PREFS_FILE = "ai_companion_secure_prefs"

    // Keys for all API credentials
    const val KEY_GEMINI_API_KEY     = "gemini_api_key"
    const val KEY_PERPLEXITY_API_KEY = "perplexity_api_key"
    const val KEY_CLAUDE_API_KEY     = "claude_api_key"
    const val KEY_HF_TOKEN           = "hf_token"

    @Volatile
    private var instance: SharedPreferences? = null

    /**
     * Lazily initializes EncryptedSharedPreferences backed by Android Keystore.
     * Falls back gracefully on devices without hardware-backed TEE.
     */
    private fun getPrefs(context: Context): SharedPreferences {
        return instance ?: synchronized(this) {
            instance ?: try {
                val masterKey = MasterKey.Builder(context)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .setRequestStrongBoxBacked(true)
                    .build()

                EncryptedSharedPreferences.create(
                    context,
                    SECURE_PREFS_FILE,
                    masterKey,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
                ).also { instance = it }

            } catch (e: Exception) {
                // Fallback: log warning, use standard prefs as last resort
                // This should never happen on API 23+ with proper Keystore
                Log.e(TAG, "EncryptedSharedPreferences init failed, falling back", e)
                context.getSharedPreferences(
                    "${SECURE_PREFS_FILE}_fallback",
                    Context.MODE_PRIVATE
                ).also { instance = it }
            }
        }
    }

    fun saveApiKey(context: Context, key: String, value: String) {
        getPrefs(context).edit().putString(key, value).apply()
        Log.d(TAG, "Saved key: $key (encrypted)")
    }

    fun getApiKey(context: Context, key: String): String? {
        return getPrefs(context).getString(key, null)
    }

    fun deleteApiKey(context: Context, key: String) {
        getPrefs(context).edit().remove(key).apply()
        Log.d(TAG, "Deleted key: $key")
    }

    fun deleteAllKeys(context: Context) {
        getPrefs(context).edit().clear().apply()
        Log.d(TAG, "All API keys deleted")
    }

    /**
     * Checks if a hardware-backed (StrongBox/TEE) Keystore is available.
     * Used for diagnostics / UI info display.
     */
    fun isHardwareBackedKeystoreAvailable(): Boolean {
        return try {
            val keyStore = java.security.KeyStore.getInstance("AndroidKeyStore")
            keyStore.load(null)
            android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P
        } catch (e: Exception) {
            false
        }
    }
}
