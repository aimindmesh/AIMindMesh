import { useCallback, useEffect, useRef, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { AppLock, isAppLockEnabled, shouldRelock } from '../services/security/appLock';

/** App lock: locked at launch when enabled, and again after a minute in the background. */
export function useAppLock(): { locked: boolean; unlock: () => void } {
    const [locked, setLocked] = useState(isAppLockEnabled);
    const backgroundSinceRef = useRef<number | null>(null);

    useEffect(() => {
        // Keeps FLAG_SECURE in line with the setting (MainActivity applies the saved one at launch)
        AppLock.setSecureScreen({ enabled: isAppLockEnabled() }).catch(() => { });
        const handle = CapApp.addListener('appStateChange', ({ isActive }) => {
            if (!isActive) {
                backgroundSinceRef.current = Date.now();
            } else {
                if (shouldRelock(isAppLockEnabled(), backgroundSinceRef.current, Date.now())) setLocked(true);
                backgroundSinceRef.current = null;
            }
        });
        return () => { handle.then(h => h.remove()).catch(() => { }); };
    }, []);

    const unlock = useCallback(() => setLocked(false), []);
    return { locked, unlock };
}
