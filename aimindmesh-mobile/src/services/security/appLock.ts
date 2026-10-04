import { registerPlugin } from '@capacitor/core';

interface AppLockPlugin {
    /** False when the phone has no screen lock to verify against. */
    isAvailable(): Promise<{ available: boolean }>;
    authenticate(options: { title: string; subtitle?: string }): Promise<{ success: boolean; reason?: string }>;
    /** Hides the app's content from screenshots and the recent apps view. */
    setSecureScreen(options: { enabled: boolean }): Promise<void>;
}

export const AppLock = registerPlugin<AppLockPlugin>('AppLock');

const SETTING = 'app-lock';
/** Back from the background after this long, the app asks again. */
export const RELOCK_AFTER_MS = 60_000;

export function isAppLockEnabled(): boolean {
    try {
        return localStorage.getItem(SETTING) === 'true';
    } catch {
        return false;
    }
}

export function setAppLockEnabled(enabled: boolean) {
    localStorage.setItem(SETTING, String(enabled));
    AppLock.setSecureScreen({ enabled }).catch(() => { });
}

/** True when the app comes back from a background stay long enough to ask again. */
export function shouldRelock(enabled: boolean, backgroundSince: number | null, now: number): boolean {
    return enabled && backgroundSince !== null && now - backgroundSince > RELOCK_AFTER_MS;
}
