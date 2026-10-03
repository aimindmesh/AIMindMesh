/**
 * Keep-alive preference: one persisted flag for both the native KeepAliveService
 * (synced by useAppLifecycle) and the JS features that keep running in background
 * (proactive engagement, memory extraction).
 */
import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'keep_alive_enabled';
const listeners = new Set<() => void>();
let current: boolean | null = null;
let migrated = false;

function read(): boolean {
    try {
        return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
}

export function isKeepAliveEnabled(): boolean {
    if (current === null) current = read();
    return current;
}

export function setKeepAliveEnabled(enabled: boolean): void {
    current = enabled;
    try {
        localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch {
        // Not persisted: still applied for this session
    }
    listeners.forEach(listener => listener());
}

/** Adopts the old `llmConfig.keepAlive` flag when the shared one was never set (checked once) */
export function migrateLegacyKeepAlive(legacy: boolean | undefined): void {
    if (migrated) return;
    migrated = true;
    try {
        if (legacy && localStorage.getItem(STORAGE_KEY) === null) setKeepAliveEnabled(true);
    } catch {
        // localStorage unavailable: nothing to migrate
    }
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/** The flag, shared live between App and the settings screen */
export function useKeepAlive(): [boolean, (enabled: boolean) => void] {
    const enabled = useSyncExternalStore(subscribe, isKeepAliveEnabled, isKeepAliveEnabled);
    return [enabled, setKeepAliveEnabled];
}

/** For tests: forget the cached value */
export function resetKeepAliveCache(): void {
    current = null;
    migrated = false;
}
