package com.aimindmesh.mobile.security

import android.content.Context
import android.util.Log

/**
 * One-time migration of API keys from plain-text Capacitor SharedPreferences
 * to EncryptedSharedPreferences (Android Keystore).
 *
 * Called from MainActivity.onCreate() on first launch after the update.
 * After migration, legacy keys are removed from CapacitorStorage.
 */
object ApiKeyMigration {

    private const val TAG = "ApiKeyMigration"
    private const val LEGACY_PREFS = "CapacitorStorage"
    private const val MIGRATION_DONE_FLAG = "api_key_migration_v1_done"

    // Mapping: Capacitor legacy key name → SecureStorageManager key constant
    private val keysToMigrate = mapOf(
        "apiKey"           to SecureStorageManager.KEY_GEMINI_API_KEY,
        "perplexityApiKey" to SecureStorageManager.KEY_PERPLEXITY_API_KEY,
        "claudeApiKey"     to SecureStorageManager.KEY_CLAUDE_API_KEY,
        "hfToken"          to SecureStorageManager.KEY_HF_TOKEN
    )

    /**
     * Migrates API keys if not already done.
     * Safe to call multiple times — uses a flag to skip after first successful run.
     */
    fun migrateIfNeeded(context: Context) {
        val legacyPrefs = context.getSharedPreferences(LEGACY_PREFS, Context.MODE_PRIVATE)

        if (legacyPrefs.getBoolean(MIGRATION_DONE_FLAG, false)) {
            Log.d(TAG, "Migration already completed, skipping.")
            return
        }

        var migratedCount = 0

        keysToMigrate.forEach { (legacyKey, secureKey) ->
            val value = legacyPrefs.getString(legacyKey, null)
            if (!value.isNullOrBlank()) {
                SecureStorageManager.saveApiKey(context, secureKey, value)
                // Remove from legacy storage after successful migration
                legacyPrefs.edit().remove(legacyKey).apply()
                migratedCount++
                Log.i(TAG, "Migrated: $legacyKey → $secureKey")
            }
        }

        legacyPrefs.edit().putBoolean(MIGRATION_DONE_FLAG, true).apply()
        Log.i(TAG, "Migration complete. Migrated $migratedCount keys.")
    }
}
