import { ProactiveSettings, DEFAULT_PROACTIVE_SETTINGS } from '../../types/index';
import { syncNativeProactiveSettings } from './nativeProactiveSync';
import { mergeProactiveSettings } from './proactiveSettings';

class ProactiveSettingsStorage {
    private STORAGE_KEY = 'proactive-settings';
    private cachedSettings: ProactiveSettings | null = null;
    private listeners: Function[] = [];

    constructor() {
        this.load(); // Optimistic load
    }

    async load(): Promise<ProactiveSettings> {
        if (this.cachedSettings) {
            return this.cachedSettings;
        }

        try {
            const value = localStorage.getItem(this.STORAGE_KEY);

            if (value) {
                const parsed = JSON.parse(value);
                // Merge with defaults to handle new settings
                this.cachedSettings = mergeProactiveSettings(parsed);
            } else {
                this.cachedSettings = DEFAULT_PROACTIVE_SETTINGS;
            }
        } catch (error) {
            console.error('Failed to load proactive settings:', error);
            this.cachedSettings = DEFAULT_PROACTIVE_SETTINGS;
        }

        return this.cachedSettings;
    }

    async save(settings: ProactiveSettings): Promise<void> {
        try {
            const value = JSON.stringify(settings);

            // Save to standard localStorage for web/PWA
            localStorage.setItem(this.STORAGE_KEY, value);

            // Native side (MainActivity, the periodic job): settings plus start/stop on `enabled`
            await syncNativeProactiveSettings(settings);

            this.cachedSettings = settings;
            this.notifyListeners(settings);

            // Emit event for window listeners if needed (e.g. for non-React parts)
            window.dispatchEvent(new CustomEvent('proactive-settings-changed', {
                detail: settings,
            }));
        } catch (error) {
            console.error('Failed to save proactive settings:', error);
            throw error;
        }
    }

    async update(partial: Partial<ProactiveSettings>): Promise<void> {
        const current = await this.load();
        const updated = { ...current, ...partial };
        await this.save(updated);
    }

    async reset(): Promise<void> {
        await this.save(DEFAULT_PROACTIVE_SETTINGS);
    }

    subscribe(callback: (settings: ProactiveSettings) => void): () => void {
        this.listeners.push(callback);
        // Return unsubscribe function
        return () => {
            this.listeners = this.listeners.filter(cb => cb !== callback);
        };
    }

    private notifyListeners(settings: ProactiveSettings) {
        this.listeners.forEach(cb => cb(settings));
    }
}

export const proactiveSettingsStorage = new ProactiveSettingsStorage();
