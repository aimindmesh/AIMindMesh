import { ProactiveSettings, DEFAULT_PROACTIVE_SETTINGS } from '../../types/index';
import ProactivePlugin from './ProactivePlugin';
import { Capacitor } from '@capacitor/core';

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
                this.cachedSettings = this.mergeWithDefaults(parsed);
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
            const previousSettings = this.cachedSettings;
            const value = JSON.stringify(settings);

            // Save to standard localStorage for web/PWA
            localStorage.setItem(this.STORAGE_KEY, value);

            // Save to Custom Plugin for Native Android (MainActivity.java reads this)
            if (Capacitor.isNativePlatform()) {
                await ProactivePlugin.updateSettings({ settings: value });
            }

            this.cachedSettings = settings;
            this.notifyListeners(settings);

            // Emit event for window listeners if needed (e.g. for non-React parts)
            window.dispatchEvent(new CustomEvent('proactive-settings-changed', {
                detail: settings,
            }));

            // Handle native service toggle if we are on Native
            if (previousSettings && previousSettings.enabled !== settings.enabled) {
                if (Capacitor.isNativePlatform()) {
                    if (settings.enabled) {
                        await ProactivePlugin.startService();
                    } else {
                        await ProactivePlugin.stopService();
                    }
                }
            }
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

    private mergeWithDefaults(
        loaded: Partial<ProactiveSettings>
    ): ProactiveSettings {
        return {
            ...DEFAULT_PROACTIVE_SETTINGS,
            ...loaded,
            quietHours: {
                ...DEFAULT_PROACTIVE_SETTINGS.quietHours,
                ...(loaded.quietHours || {}),
            },
            permissions: {
                ...DEFAULT_PROACTIVE_SETTINGS.permissions,
                ...(loaded.permissions || {}),
            },
            actionControls: {
                ...DEFAULT_PROACTIVE_SETTINGS.actionControls,
                ...(loaded.actionControls || {})
            },
            contextAwareness: {
                ...DEFAULT_PROACTIVE_SETTINGS.contextAwareness,
                ...(loaded.contextAwareness || {}),
            },
            notifications: {
                ...DEFAULT_PROACTIVE_SETTINGS.notifications,
                ...(loaded.notifications || {}),
            },
            learning: {
                ...DEFAULT_PROACTIVE_SETTINGS.learning,
                ...(loaded.learning || {}),
            },
            limits: {
                ...DEFAULT_PROACTIVE_SETTINGS.limits,
                ...(loaded.limits || {}),
            },
        };
    }
}

export const proactiveSettingsStorage = new ProactiveSettingsStorage();
