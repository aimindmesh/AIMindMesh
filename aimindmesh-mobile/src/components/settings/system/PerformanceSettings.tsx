import React, { useEffect, useState } from 'react';
import Performance from '../../../services/performancePlugin';
import { triggerHaptic } from '../../../services/native';
import { useKeepAlive } from '../../../services/performance/keepAliveSetting';

const PerformanceSettings: React.FC = () => {
    const [isIgnoringBattery, setIsIgnoringBattery] = useState(false);
    // Shared flag: App starts/stops the native services and its background features from it
    const [keepAliveEnabled, setKeepAliveEnabled] = useKeepAlive();

    useEffect(() => {
        checkStatus();
    }, []);

    const checkStatus = async () => {
        try {
            const { isIgnoring } = await Performance.isIgnoringBatteryOptimizations();
            setIsIgnoringBattery(isIgnoring);
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

    const handleKeepAliveToggle = (enabled: boolean) => {
        triggerHaptic();
        setKeepAliveEnabled(enabled);
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
