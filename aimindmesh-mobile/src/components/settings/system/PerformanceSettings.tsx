import React, { useEffect, useState } from 'react';
import Performance from '../../../services/performancePlugin';
import { triggerHaptic } from '../../../services/native';

const PerformanceSettings: React.FC = () => {
    const [isIgnoringBattery, setIsIgnoringBattery] = useState(false);
    const [keepAliveEnabled, setKeepAliveEnabled] = useState(false);

    useEffect(() => {
        checkStatus();
    }, []);

    const checkStatus = async () => {
        try {
            const { isIgnoring } = await Performance.isIgnoringBatteryOptimizations();
            setIsIgnoringBattery(isIgnoring);

            // We don't have a way to check if service is running easily without more native code,
            // but for now we can persist state or just rely on user toggle.
            // For this iteration, let's just assume false on load or manage state locally/persisted.
            // Ideally we'd save this preference in local storage.
            const storedKeepAlive = localStorage.getItem('keep_alive_enabled');
            const isEnabled = storedKeepAlive === 'true';
            setKeepAliveEnabled(isEnabled);

            // Re-sync with native layer on mount just in case
            if (isEnabled) {
                Performance.startKeepAlive().catch(e => console.error('Failed to sync KeepAlive on mount', e));
            }
        } catch (e) {
            console.error('Failed to check performance status', e);
        }
    };

    const handleBatteryOptimization = async () => {
        triggerHaptic();
        try {
            await Performance.requestIgnoreBatteryOptimizations();
            // Re-check after a delay as the user needs to interact with system dialog
            setTimeout(checkStatus, 1000);
            // Also listen to app resume event if possible, but timeout is a simple start
        } catch (e) {
            console.error('Failed to request battery optimization', e);
        }
    };

    const handleKeepAliveToggle = async (enabled: boolean) => {
        triggerHaptic();
        setKeepAliveEnabled(enabled);
        localStorage.setItem('keep_alive_enabled', String(enabled));

        try {
            if (enabled) {
                await Performance.startKeepAlive();
            } else {
                await Performance.stopKeepAlive();
            }
        } catch (e) {
            console.error('Failed to toggle keep alive', e);
            // Revert on error
            setKeepAliveEnabled(!enabled);
            localStorage.setItem('keep_alive_enabled', String(!enabled));
        }
    };

    return (
        <div className="space-y-4 mb-4">
            <div className="bg-surface/30 p-4 rounded-lg border border-white/5">
                <h3 className="text-sm font-medium textPrimary mb-3">🚀 Performance & Persistence</h3>

                {/* Battery Optimization */}
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <p className="text-sm font-medium textPrimary">Unrestricted Background Usage</p>
                        <p className="text-xs textSecondary">
                            Prevents Android from killing the app to save battery.
                        </p>
                        {isIgnoringBattery && (
                            <span className="text-[10px] text-green-400 flex items-center gap-1 mt-1">
                                ✓ Active
                            </span>
                        )}
                    </div>
                    {!isIgnoringBattery ? (
                        <button
                            onClick={handleBatteryOptimization}
                            className="text-xs px-3 py-1.5 bg-primary/20 text-primary border border-primary/30 rounded font-medium hover:bg-primary/30 transition-colors"
                        >
                            Enable
                        </button>
                    ) : (
                        <div className="opacity-50 text-xs px-3 py-1.5 border border-white/10 rounded font-medium">
                            Enabled
                        </div>
                    )}
                </div>

                {/* Keep Alive Service */}
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-sm font-medium textPrimary">Keep Alive Service</p>
                        <p className="text-xs textSecondary">
                            Runs a visible notification to ensure the app stays in memory.
                        </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            checked={keepAliveEnabled}
                            onChange={(e) => handleKeepAliveToggle(e.target.checked)}
                            className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-surface peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
                    </label>
                </div>
            </div>
        </div>
    );
};

export default PerformanceSettings;
