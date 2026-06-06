import React, { useState, useEffect } from 'react';
import { ThemeConfig, ThemeColors, THEME_PRESETS, DEFAULT_THEME_COLORS } from '../../../types';
import { triggerHaptic } from '../../../services/native';

interface ThemeSettingsProps {
    themeConfig: ThemeConfig;
    onThemeConfigChange: (config: ThemeConfig) => void;
}

// Helper to apply theme colors to CSS variables
export const applyTheme = (colors: ThemeColors, isSystem?: boolean) => {
    const root = document.documentElement;
    if (isSystem) {
        // Clear inline styles to let index.css media queries handle it
        root.style.removeProperty('--color-background');
        root.style.removeProperty('--color-surface');
        root.style.removeProperty('--color-primary');
        root.style.removeProperty('--color-secondary');
        root.style.removeProperty('--color-bubble-user');
        root.style.removeProperty('--color-bubble-model');
        root.style.removeProperty('--color-input');
        root.style.removeProperty('--color-text-primary');
        root.style.removeProperty('--color-text-secondary');
        root.style.removeProperty('--color-online');
        root.style.removeProperty('--gradient-glow-color');
        root.setAttribute('data-theme', 'system');
        return;
    }

    root.removeAttribute('data-theme');
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
};

// Get resolved colors from config
export const getThemeColors = (config: ThemeConfig): ThemeColors => {
    if (config.presetId === 'custom') {
        return { ...DEFAULT_THEME_COLORS, ...config.customColors };
    }
    const preset = THEME_PRESETS.find(p => p.id === config.presetId);
    return preset?.colors ?? DEFAULT_THEME_COLORS;
};

const ThemeSettings: React.FC<ThemeSettingsProps> = ({
    themeConfig,
    onThemeConfigChange,
}) => {
    const [selectedPresetId, setSelectedPresetId] = useState(themeConfig.presetId);
    const [customColors, setCustomColors] = useState<Partial<ThemeColors>>(
        themeConfig.customColors ?? {}
    );

    // Track when user modifies custom colors
    const isCustomMode = selectedPresetId === 'custom';

    useEffect(() => {
        setSelectedPresetId(themeConfig.presetId);
        setCustomColors(themeConfig.customColors ?? {});
    }, [themeConfig]);

    const handlePresetChange = (presetId: string) => {
        triggerHaptic();
        setSelectedPresetId(presetId);

        if (presetId === 'custom') {
            // Initialize custom colors from current resolved colors
            const currentColors = getThemeColors(themeConfig);
            setCustomColors(currentColors);
            onThemeConfigChange({ presetId: 'custom', customColors: currentColors });
        } else {
            onThemeConfigChange({ presetId });
        }
    };

    const handleCustomColorChange = (key: keyof ThemeColors, value: string) => {
        const newCustomColors = { ...customColors, [key]: value };
        setCustomColors(newCustomColors);
        onThemeConfigChange({ presetId: 'custom', customColors: newCustomColors });
    };

    // Color labels for UI
    const colorLabels: { key: keyof ThemeColors; label: string }[] = [
        { key: 'primary', label: 'Primary Color' },
        { key: 'secondary', label: 'Secondary Color' },
        { key: 'background', label: 'Background' },
        { key: 'surface', label: 'Surface' },
        { key: 'input', label: 'Input Field' },
        { key: 'textPrimary', label: 'Text Primary' },
        { key: 'textSecondary', label: 'Text Secondary' },
        { key: 'bubbleUser', label: 'User Bubble' },
        { key: 'bubbleModel', label: 'Model Bubble' },
        { key: 'online', label: 'Online Status' },
        { key: 'gradientGlow', label: 'Gradient Glow' },
    ];

    // Get display colors (either from preset or custom)
    const displayColors = isCustomMode
        ? { ...DEFAULT_THEME_COLORS, ...customColors }
        : getThemeColors({ presetId: selectedPresetId });

    return (
        <div className="p-6 space-y-6">
            <div>
                <h3 className="text-lg font-semibold text-text-primary mb-2">🎨 Theme</h3>
                <p className="text-sm text-text-secondary">
                    Choose a color preset or create your own custom theme.
                </p>
            </div>

            {/* Preset Selection */}
            <div className="space-y-3">
                <label className="text-sm font-medium text-text-primary">Color Presets</label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {THEME_PRESETS.map((preset) => (
                        <button
                            key={preset.id}
                            onClick={() => handlePresetChange(preset.id)}
                            className={`p-3 rounded-xl border-2 transition-all ${selectedPresetId === preset.id
                                ? 'border-primary bg-primary/10'
                                : 'border-white/10 bg-surface/50 hover:border-white/20'
                                }`}
                        >
                            <div className="flex items-center gap-2 mb-2">
                                <div
                                    className="w-5 h-5 rounded-full"
                                    style={{ backgroundColor: preset.colors.primary }}
                                />
                                <div
                                    className="w-5 h-5 rounded-full"
                                    style={{ backgroundColor: preset.colors.secondary }}
                                />
                            </div>
                            <span className="text-sm font-medium text-text-primary">{preset.name}</span>
                        </button>
                    ))}

                    {/* Custom Option */}
                    <button
                        onClick={() => handlePresetChange('custom')}
                        className={`p-3 rounded-xl border-2 transition-all ${selectedPresetId === 'custom'
                            ? 'border-primary bg-primary/10'
                            : 'border-white/10 bg-surface/50 hover:border-white/20'
                            }`}
                    >
                        <div className="flex items-center gap-2 mb-2">
                            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-red-500 via-green-500 to-blue-500" />
                            <span className="text-lg">✏️</span>
                        </div>
                        <span className="text-sm font-medium text-text-primary">Custom</span>
                    </button>
                </div>
            </div>

            {/* Custom Color Pickers (Only shown in custom mode) */}
            {isCustomMode && (
                <div className="space-y-4 pt-4 border-t border-white/10">
                    <label className="text-sm font-medium text-text-primary">Custom Colors</label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {colorLabels.map(({ key, label }) => (
                            <div key={key} className="flex items-center justify-between gap-3 p-3 bg-surface/50 rounded-lg">
                                <span className="text-sm text-text-secondary">{label}</span>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="color"
                                        value={displayColors[key]}
                                        onChange={(e) => handleCustomColorChange(key, e.target.value)}
                                        className="w-10 h-10 rounded-lg border border-white/10 cursor-pointer bg-transparent"
                                    />
                                    <input
                                        type="text"
                                        value={displayColors[key]}
                                        onChange={(e) => handleCustomColorChange(key, e.target.value)}
                                        className="w-20 px-2 py-1 text-xs font-mono bg-background border border-white/10 rounded text-text-primary"
                                        placeholder="#000000"
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Preview */}
            <div className="space-y-3 pt-4 border-t border-white/10">
                <label className="text-sm font-medium text-text-primary">Preview</label>
                <div
                    className="p-4 rounded-xl border border-white/5"
                    style={{ backgroundColor: displayColors.background }}
                >
                    <div
                        className="p-3 rounded-lg mb-3"
                        style={{ backgroundColor: displayColors.surface }}
                    >
                        <span style={{ color: displayColors.textPrimary }} className="font-medium">
                            Sample Header
                        </span>
                        <p style={{ color: displayColors.textSecondary }} className="text-sm mt-1">
                            This is secondary text in the preview area.
                        </p>
                    </div>
                    <div className="flex gap-3">
                        <div
                            className="px-4 py-2 rounded-full text-white text-sm font-medium"
                            style={{
                                background: `linear-gradient(135deg, ${displayColors.primary} 0%, ${displayColors.secondary} 100%)`,
                            }}
                        >
                            User Message
                        </div>
                        <div
                            className="px-4 py-2 rounded-full text-sm"
                            style={{
                                backgroundColor: displayColors.bubbleModel,
                                color: displayColors.textPrimary,
                            }}
                        >
                            Model Reply
                        </div>
                    </div>
                    <div className="mt-3">
                        <input
                            type="text"
                            placeholder="Input field preview..."
                            className="w-full px-3 py-2 rounded-lg text-sm"
                            style={{
                                backgroundColor: displayColors.input,
                                color: displayColors.textPrimary,
                                border: '1px solid rgba(255,255,255,0.1)',
                            }}
                            readOnly
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ThemeSettings;
