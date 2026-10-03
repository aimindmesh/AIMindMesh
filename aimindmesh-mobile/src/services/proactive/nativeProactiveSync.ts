import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { ProactiveSettings } from '../../types';
import { logger } from '../logger';
import ProactivePlugin from './ProactivePlugin';

/** `enabled` last handed to the native job (undefined: not yet in this app run) */
let lastSyncedEnabled: boolean | undefined;

/**
 * Hands the proactive settings to the native side (MainActivity and the notification helper
 * read them from SharedPreferences, which the WebView's localStorage is not) and starts or
 * stops the periodic WorkManager job when `enabled` changes.
 */
export async function syncNativeProactiveSettings(settings: ProactiveSettings): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    try {
        await ProactivePlugin.updateSettings({ settings: JSON.stringify(settings) });
        const enabled = settings.enabled !== false;
        if (enabled !== lastSyncedEnabled) {
            if (enabled) await ProactivePlugin.startService();
            else await ProactivePlugin.stopService();
            lastSyncedEnabled = enabled;
        }
    } catch (e) {
        logger.log('warn', '[NativeProactiveSync] Sync to the native side failed', e);
    }
}

/** Keeps the native side in step with the settings App holds (synced once at start, then on change). */
export function useNativeProactiveSync(settings: ProactiveSettings | undefined): void {
    const json = settings ? JSON.stringify(settings) : '';
    useEffect(() => {
        if (settings) void syncNativeProactiveSettings(settings);
    }, [json]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Test hook: forget what was synced */
export function resetNativeProactiveSync(): void {
    lastSyncedEnabled = undefined;
}
