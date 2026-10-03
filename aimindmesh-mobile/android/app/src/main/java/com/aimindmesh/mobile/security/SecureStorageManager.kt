package com.aimindmesh.mobile.security

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.KeyStore
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory

/**
 * Singleton manager for secret storage (API keys) using Android Keystore.
 * Values are encrypted at rest with AES-256-GCM, with a master key in the
 * hardware TEE/StrongBox when available.
 *
 * If EncryptedSharedPreferences cannot be created the manager falls back to plain
 * SharedPreferences, and says so through [mode]: callers (the JS secret store) then
 * keep their data where it is instead of "migrating" it to an unencrypted file.
 */
object SecureStorageManager {

    private const val TAG = "SecureStorageManager"
    private const val SECURE_PREFS_FILE = "ai_companion_secure_prefs"

    enum class Mode { ENCRYPTED, PLAIN_FALLBACK }

    @Volatile
    private var instance: SharedPreferences? = null

    @Volatile
    var mode: Mode = Mode.PLAIN_FALLBACK
        private set

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
                ).also {
                    mode = Mode.ENCRYPTED
                    instance = it
                }
            } catch (e: Exception) {
                Log.e(TAG, "EncryptedSharedPreferences init failed, using PLAIN fallback", e)
                mode = Mode.PLAIN_FALLBACK
                context.getSharedPreferences(
                    "${SECURE_PREFS_FILE}_fallback",
                    Context.MODE_PRIVATE
                ).also { instance = it }
            }
        }
    }

    /** Initializes the storage and reports whether values are really encrypted. */
    fun currentMode(context: Context): Mode {
        getPrefs(context)
        return mode
    }

    /**
     * Writes synchronously (commit) and reads the value back.
     * Returns true only if the value is durably stored.
     */
    fun saveApiKey(context: Context, key: String, value: String): Boolean {
        val prefs = getPrefs(context)
        val committed = prefs.edit().putString(key, value).commit()
        val verified = committed && prefs.getString(key, null) == value
        if (!verified) Log.e(TAG, "Write of $key not verified (committed=$committed)")
        return verified
    }

    fun getApiKey(context: Context, key: String): String? {
        return getPrefs(context).getString(key, null)
    }

    fun getMany(context: Context, keys: Collection<String>): Map<String, String?> {
        val prefs = getPrefs(context)
        return keys.associateWith { prefs.getString(it, null) }
    }

    fun deleteApiKey(context: Context, key: String): Boolean {
        return getPrefs(context).edit().remove(key).commit()
    }

    /**
     * True when the master key lives in secure hardware (TEE or StrongBox),
     * read from the key's own KeyInfo instead of guessing from the API level.
     */
    fun isHardwareBackedKeystoreAvailable(context: Context): Boolean {
        if (currentMode(context) != Mode.ENCRYPTED) return false
        return try {
            val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            val key = keyStore.getKey(MasterKey.DEFAULT_MASTER_KEY_ALIAS, null) as? SecretKey ?: return false
            val info = SecretKeyFactory.getInstance(key.algorithm, "AndroidKeyStore")
                .getKeySpec(key, KeyInfo::class.java) as KeyInfo
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                info.securityLevel == KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT ||
                    info.securityLevel == KeyProperties.SECURITY_LEVEL_STRONGBOX
            } else {
                @Suppress("DEPRECATION")
                info.isInsideSecureHardware
            }
        } catch (e: Exception) {
            Log.w(TAG, "KeyInfo check failed", e)
            false
        }
    }
}
