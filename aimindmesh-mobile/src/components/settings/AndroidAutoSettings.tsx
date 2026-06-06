import React from 'react';
import { AndroidAuto } from 'android-auto-capacitor';

interface AndroidAutoSettingsProps {
    settings: {
        enabled: boolean;
        showCallMode: boolean;
        showCalendar: boolean;
        showToDo: boolean;
        showKanban: boolean;
    };
    onSettingsChange: (newSettings: any) => void;
}

export const DEFAULT_ANDROID_AUTO_SETTINGS = {
    enabled: true,
    showCallMode: true,
    showCalendar: true,
    showToDo: true,
    showKanban: true
};

const AndroidAutoSettings: React.FC<AndroidAutoSettingsProps> = ({ settings, onSettingsChange }) => {

    const handleChange = (key: string, value: boolean) => {
        const newSettings = { ...settings, [key]: value };
        onSettingsChange(newSettings);

        // Sync with native plugin immediately
        AndroidAuto.updateSettings(newSettings);
    };

    return (
        <div className="space-y-6">
            <div className="space-y-4">
                <h3 className="text-lg font-medium text-white">Android Auto Integration</h3>
                <p className="text-sm text-textSecondary">
                    Configure which features are visible on your car's display.
                </p>

                {/* Master Toggle */}
                <div className="flex items-center justify-between p-4 bg-surface rounded-lg border border-white/5">
                    <div>
                        <div className="font-medium text-white">Enable Integration</div>
                        <div className="text-xs text-textSecondary">Show app on Android Auto</div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={settings.enabled}
                            onChange={(e) => handleChange('enabled', e.target.checked)}
                        />
                        <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                    </label>
                </div>

                {settings.enabled && (
                    <div className="space-y-3 pl-2">

                        {/* Assistant Call */}
                        <div className="flex items-center justify-between p-3 bg-surface/50 rounded-lg border border-white/5">
                            <span className="text-sm text-textPrimary">Show "Assistant Call"</span>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="sr-only peer"
                                    checked={settings.showCallMode}
                                    onChange={(e) => handleChange('showCallMode', e.target.checked)}
                                />
                                <div className="w-9 h-5 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                            </label>
                        </div>

                        {/* Calendar */}
                        <div className="flex items-center justify-between p-3 bg-surface/50 rounded-lg border border-white/5">
                            <span className="text-sm text-textPrimary">Show Calendar</span>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="sr-only peer"
                                    checked={settings.showCalendar}
                                    onChange={(e) => handleChange('showCalendar', e.target.checked)}
                                />
                                <div className="w-9 h-5 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                            </label>
                        </div>

                        {/* To-Do */}
                        <div className="flex items-center justify-between p-3 bg-surface/50 rounded-lg border border-white/5">
                            <span className="text-sm text-textPrimary">Show To-Do List</span>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="sr-only peer"
                                    checked={settings.showToDo}
                                    onChange={(e) => handleChange('showToDo', e.target.checked)}
                                />
                                <div className="w-9 h-5 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                            </label>
                        </div>

                        {/* Kanban */}
                        <div className="flex items-center justify-between p-3 bg-surface/50 rounded-lg border border-white/5">
                            <span className="text-sm text-textPrimary">Show Kanban Board</span>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="sr-only peer"
                                    checked={settings.showKanban}
                                    onChange={(e) => handleChange('showKanban', e.target.checked)}
                                />
                                <div className="w-9 h-5 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                            </label>
                        </div>

                    </div>
                )}
            </div>
        </div>
    );
};

export default AndroidAutoSettings;
