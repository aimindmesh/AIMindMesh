import { Capacitor } from '@capacitor/core';

export type Platform = 'android' | 'ios' | 'web' | 'desktop';

export const isTauri = () => {
    // Check for Tauri internals which are injected into the window object
    return !!(window as any).__TAURI_INTERNALS__;
};

export const getPlatform = (): Platform => {
    if (isTauri()) {
        return 'desktop';
    }
    const capPlatform = Capacitor.getPlatform();
    if (capPlatform === 'ios' || capPlatform === 'android') {
        return capPlatform as Platform;
    }
    return 'web';
};

export const isMobile = () => {
    const platform = getPlatform();
    return platform === 'android' || platform === 'ios';
};

export const isDesktop = () => {
    return getPlatform() === 'desktop';
};

export const isWeb = () => {
    return getPlatform() === 'web';
};
