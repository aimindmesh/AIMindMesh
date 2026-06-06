/**
 * useTheme Hook
 * 
 * Manages the application theme, including system-aware dark/light mode.
 * When 'system' theme is selected, it follows the device's `prefers-color-scheme`
 * and updates in real-time without requiring app restart.
 * 
 * Theme is applied via CSS custom properties on `document.documentElement`.
 * The 'system' theme uses CSS `data-theme="system"` with media query overrides.
 * Named themes apply CSS variables directly via JavaScript for full control.
 */

import { useState, useEffect, useCallback } from 'react';
import { THEME_PRESETS, ThemeColors } from '../types';

const THEME_STORAGE_KEY = 'app_theme_preset_id';

/**
 * Apply theme CSS variables to the document root
 */
function applyThemeColors(colors: ThemeColors): void {
    const root = document.documentElement;
    root.style.setProperty('--color-background', colors.background);
    root.style.setProperty('--color-surface', colors.surface);
    root.style.setProperty('--color-primary', colors.primary);
    root.style.setProperty('--color-secondary', colors.secondary);
    root.style.setProperty('--color-bubble-user', colors.bubbleUser);
    root.style.setProperty('--color-bubble-model', colors.bubbleModel);
    root.style.setProperty('--color-input', colors.input);
    root.style.setProperty('--color-text-primary', colors.textPrimary);
    root.style.setProperty('--color-text-secondary', colors.textSecondary);
    root.style.setProperty('--color-online', colors.online);
    root.style.setProperty('--gradient-glow-color', colors.gradientGlow);
}

/**
 * Clear inline CSS variables (let stylesheet handle them for system theme)
 */
function clearInlineThemeColors(): void {
    const root = document.documentElement;
    const vars = [
        '--color-background', '--color-surface', '--color-primary', '--color-secondary',
        '--color-bubble-user', '--color-bubble-model', '--color-input',
        '--color-text-primary', '--color-text-secondary', '--color-online',
        '--gradient-glow-color'
    ];
    vars.forEach(v => root.style.removeProperty(v));
}

export function useTheme() {
    const [themeId, setThemeId] = useState<string>(() => {
        try {
            return localStorage.getItem(THEME_STORAGE_KEY) || 'system';
        } catch {
            return 'system';
        }
    });

    // Apply theme when themeId changes
    useEffect(() => {
        const root = document.documentElement;

        if (themeId === 'system') {
            // System theme: use data-theme attribute, CSS media query handles dark/light
            root.setAttribute('data-theme', 'system');
            clearInlineThemeColors();
        } else {
            // Named theme: apply colors via JS and remove data-theme
            root.removeAttribute('data-theme');
            const preset = THEME_PRESETS.find(p => p.id === themeId);
            if (preset) {
                applyThemeColors(preset.colors);
            }
        }

        // Persist
        try {
            localStorage.setItem(THEME_STORAGE_KEY, themeId);
        } catch {
            // localStorage may not be available
        }
    }, [themeId]);

    // Listen for system dark/light mode changes in real-time
    useEffect(() => {
        if (themeId !== 'system') return;

        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = () => {
            // data-theme="system" + CSS media query handles the switch automatically
            // Force re-render to update any JS-dependent color logic
            document.documentElement.setAttribute('data-theme', 'system');
        };

        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, [themeId]);

    const changeTheme = useCallback((newThemeId: string) => {
        setThemeId(newThemeId);
    }, []);

    return {
        themeId,
        changeTheme,
        themes: THEME_PRESETS,
        isSystemTheme: themeId === 'system',
    };
}
