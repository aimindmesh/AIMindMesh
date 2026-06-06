/**
 * Secure Storage Service
 * 
 * Bridges to the native SecureStoragePlugin for encrypted API key storage
 * using Android Keystore (AES-256-GCM, hardware TEE when available).
 * 
 * On web/development, falls back to simple in-memory storage.
 */

import { registerPlugin } from '@capacitor/core';
import { Capacitor } from '@capacitor/core';

interface SecureStoragePlugin {
    saveApiKey(opts: { key: string; value: string }): Promise<void>;
    getApiKey(opts: { key: string }): Promise<{ value: string; found: boolean }>;
    deleteApiKey(opts: { key: string }): Promise<void>;
    deleteAllKeys(): Promise<void>;
    isHardwareBacked(): Promise<{ hardwareBacked: boolean }>;
}

const SecureStorage = registerPlugin<SecureStoragePlugin>('SecureStorage');

// Mapping of provider names to their secure storage key names
export const API_KEY_NAMES = {
    GEMINI: 'gemini_api_key',
    PERPLEXITY: 'perplexity_api_key',
    CLAUDE: 'claude_api_key',
    HF_TOKEN: 'hf_token',
} as const;

export type ApiKeyProvider = keyof typeof API_KEY_NAMES;

// In-memory fallback for web/dev environments
const memoryStore: Record<string, string> = {};

export const secureStorageService = {
    /**
     * Save an API key to encrypted storage.
     */
    async saveApiKey(provider: ApiKeyProvider, value: string): Promise<void> {
        if (!Capacitor.isNativePlatform()) {
            memoryStore[API_KEY_NAMES[provider]] = value;
            return;
        }
        await SecureStorage.saveApiKey({ key: API_KEY_NAMES[provider], value });
    },

    /**
     * Retrieve an API key from encrypted storage.
     * Returns null if the key is not found.
     */
    async getApiKey(provider: ApiKeyProvider): Promise<string | null> {
        if (!Capacitor.isNativePlatform()) {
            return memoryStore[API_KEY_NAMES[provider]] || null;
        }
        const { value, found } = await SecureStorage.getApiKey({ key: API_KEY_NAMES[provider] });
        return found ? value : null;
    },

    /**
     * Delete a specific API key from encrypted storage.
     */
    async deleteApiKey(provider: ApiKeyProvider): Promise<void> {
        if (!Capacitor.isNativePlatform()) {
            delete memoryStore[API_KEY_NAMES[provider]];
            return;
        }
        await SecureStorage.deleteApiKey({ key: API_KEY_NAMES[provider] });
    },

    /**
     * Delete all API keys from encrypted storage.
     */
    async deleteAllKeys(): Promise<void> {
        if (!Capacitor.isNativePlatform()) {
            Object.keys(memoryStore).forEach(k => delete memoryStore[k]);
            return;
        }
        await SecureStorage.deleteAllKeys();
    },

    /**
     * Check if hardware-backed Keystore (TEE/StrongBox) is available.
     */
    async isHardwareBacked(): Promise<boolean> {
        if (!Capacitor.isNativePlatform()) {
            return false;
        }
        const { hardwareBacked } = await SecureStorage.isHardwareBacked();
        return hardwareBacked;
    },
};
