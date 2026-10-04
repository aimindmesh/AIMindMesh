import { ProactiveSettings, DEFAULT_PROACTIVE_SETTINGS } from '../../types/proactive';

const STORAGE_KEY = 'proactive-settings';

/** Saved settings completed with the defaults (settings saved by older versions lack newer fields). */
export function mergeProactiveSettings(loaded: Partial<ProactiveSettings> | null | undefined): ProactiveSettings {
    const saved = loaded || {};
    return {
        ...DEFAULT_PROACTIVE_SETTINGS,
        ...saved,
        quietHours: { ...DEFAULT_PROACTIVE_SETTINGS.quietHours, ...(saved.quietHours || {}) },
        permissions: { ...DEFAULT_PROACTIVE_SETTINGS.permissions, ...(saved.permissions || {}) },
        actionControls: { ...DEFAULT_PROACTIVE_SETTINGS.actionControls, ...(saved.actionControls || {}) },
        contextAwareness: { ...DEFAULT_PROACTIVE_SETTINGS.contextAwareness, ...(saved.contextAwareness || {}) },
        notifications: { ...DEFAULT_PROACTIVE_SETTINGS.notifications, ...(saved.notifications || {}) },
        learning: { ...DEFAULT_PROACTIVE_SETTINGS.learning, ...(saved.learning || {}) },
        limits: { ...DEFAULT_PROACTIVE_SETTINGS.limits, ...(saved.limits || {}) },
    };
}

/** Current proactive settings as App saved them ('proactive-settings'), completed with the defaults. */
export function readProactiveSettings(): ProactiveSettings {
    try {
        const value = localStorage.getItem(STORAGE_KEY);
        return mergeProactiveSettings(value ? JSON.parse(value) : null);
    } catch {
        return mergeProactiveSettings(null);
    }
}
