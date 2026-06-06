import React, { useState } from 'react';
import { CapacitorHttp } from '@capacitor/core';
import { ResponseStyle, AIMindMeshServerSettings } from '../../../types';
import { triggerHaptic } from '../../../services/native';
import { logger } from '../../../services/logger';
import PerformanceSettings from './PerformanceSettings';
import { version } from '../../../../package.json';

interface AppSettingsProps {
    autoPlayAudio: boolean;
    onAutoPlayAudioChange: (enabled: boolean) => void;
    enableDnd: boolean;
    onEnableDndChange: (enabled: boolean) => void;
    dndStart: string;
    onDndStartChange: (time: string) => void;
    dndEnd: string;
    onDndEndChange: (time: string) => void;
    responseStyle: ResponseStyle;
    onResponseStyleChange: (style: ResponseStyle) => void;
    onClearChatHistory: () => void;
    enableSystemMonitor: boolean;
    onEnableSystemMonitorChange: (enabled: boolean) => void;
    systemMonitorFrequency: number;
    onSystemMonitorFrequencyChange: (freq: number) => void;
    showRam: boolean;
    onShowRamChange: (enabled: boolean) => void;
    showAppRam: boolean;
    onShowAppRamChange: (enabled: boolean) => void;
    showCpu: boolean;
    onShowCpuChange: (enabled: boolean) => void;
    showGpu: boolean;
    onShowGpuChange: (enabled: boolean) => void;
    enableNotificationVibration: boolean;
    onEnableNotificationVibrationChange: (enabled: boolean) => void;
    saveMeetingAudio: boolean;
    onSaveMeetingAudioChange: (enabled: boolean) => void;
    aimindmeshServer?: AIMindMeshServerSettings;
    autoCheckUpdates: boolean;
    onAutoCheckUpdatesChange: (enabled: boolean) => void;
}

// Self-contained toggle for debug logging
const DebugLoggingToggle: React.FC = () => {
    const [isEnabled, setIsEnabled] = useState(logger.getIsEnabled());
    const [exportStatus, setExportStatus] = useState<string | null>(null);

    const handleToggle = (enabled: boolean) => {
        if (enabled) {
            logger.enable();
        } else {
            logger.disable();
        }
        setIsEnabled(enabled);
        triggerHaptic();
    };

    const handleExportLogs = async () => {
        try {
            setExportStatus('Exporting...');
            triggerHaptic();
            const path = await logger.exportLogs();
            setExportStatus(`Saved to ${path}`);
            setTimeout(() => setExportStatus(null), 4000);
        } catch (error) {
            setExportStatus('Export failed');
            setTimeout(() => setExportStatus(null), 3000);
        }
    };

    return (
        <div className="space-y-2 mb-4">
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-sm font-medium text-text-primary">🐛 Debug Logging</p>
                    <p className="text-xs text-text-secondary">Show detailed logs in console/logcat.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                    <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={(e) => handleToggle(e.target.checked)}
                        className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-surface peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                </label>
            </div>
            <div className="flex items-center gap-2">
                <button
                    onClick={handleExportLogs}
                    className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-400 rounded text-xs font-medium transition-colors"
                >
                    📤 Export Logs
                </button>
                {exportStatus && (
                    <span className="text-xs text-text-secondary">{exportStatus}</span>
                )}
            </div>
        </div>
    );
};

const AppSettings: React.FC<AppSettingsProps> = ({
    autoPlayAudio,
    onAutoPlayAudioChange,
    enableDnd,
    onEnableDndChange,
    dndStart,
    onDndStartChange,
    dndEnd,
    onDndEndChange,
    responseStyle,
    onResponseStyleChange,
    onClearChatHistory,
    enableSystemMonitor,
    onEnableSystemMonitorChange,
    systemMonitorFrequency,
    onSystemMonitorFrequencyChange,
    showRam,
    onShowRamChange,
    showAppRam,
    onShowAppRamChange,
    showCpu,
    onShowCpuChange,
    showGpu,
    onShowGpuChange,
    enableNotificationVibration,
    onEnableNotificationVibrationChange,
    saveMeetingAudio,
    onSaveMeetingAudioChange,
    aimindmeshServer,
    autoCheckUpdates,
    onAutoCheckUpdatesChange
}) => {
    const [updateStatus, setUpdateStatus] = useState<{
        latestVersion?: string;
        isNewer: boolean;
        apk?: string;
        isLoading: boolean;
        error?: string;
    }>({ isNewer: false, isLoading: false });

    const compareVersions = (v1: string, v2: string) => {
        const parts1 = v1.split('.').map(Number);
        const parts2 = v2.split('.').map(Number);
        for (let i = 0; i < 3; i++) {
            if ((parts1[i] || 0) > (parts2[i] || 0)) return 1;
            if ((parts1[i] || 0) < (parts2[i] || 0)) return -1;
        }
        return 0;
    };

    const checkUpdates = async (silent = false) => {
        const targetServer = aimindmeshServer?.enabled ? aimindmeshServer.serverUrl : null;
        const apiKey = aimindmeshServer?.enabled ? aimindmeshServer.apiKey : '';

        if (!targetServer) return;
        if (!silent) setUpdateStatus(prev => ({ ...prev, isLoading: true, error: undefined }));

        const url = targetServer.replace(/\/$/, '') + '/dl/versions.json';
        logger.log('info', `[Updates] Requesting manifest: ${url} (Auth: ${apiKey ? 'APIKey' : 'Public'})`);

        try {
            const resp = await CapacitorHttp.request({
                url,
                method: 'GET',
                headers: {
                    'x-api-key': apiKey,
                    'Accept': 'application/json'
                },
                connectTimeout: 8000,
                readTimeout: 8000
            });

            if (resp.status !== 200) {
                const errorMsg = `Update server returned ${resp.status}`;
                logger.log('error', `[Updates] HTTP Error: ${errorMsg}`, { url, status: resp.status });
                throw new Error(`Server error ${resp.status} (Check VPN/Auth)`);
            }

            const data = resp.data;
            const latest = data.android?.version;
            if (!latest) {
                logger.log('error', '[Updates] Invalid manifest format', { data });
                throw new Error('Invalid manifest');
            }

            const current = version;
            const isNewer = compareVersions(latest, current) > 0;

            logger.log('info', `[Updates] Version check: Current=${current}, Latest=${latest}, Result=${isNewer ? 'UPDATE_AVAIL' : 'UP_TO_DATE'}`);

            setUpdateStatus({
                latestVersion: latest,
                isNewer,
                apk: data.android.apk,
                isLoading: false
            });
        } catch (e: any) {
            logger.log('error', `[Updates] Fetch failed for ${url}`, { error: e.message });
            setUpdateStatus(prev => ({ 
                ...prev, 
                isLoading: false, 
                error: e.message || 'Check connection'
            }));
        }
    };

    React.useEffect(() => {
        if (autoCheckUpdates) {
            checkUpdates(true);
        }
    }, [autoCheckUpdates, aimindmeshServer?.enabled, aimindmeshServer?.serverUrl]);

    const handleClearHistory = () => {
        if (window.confirm("Are you sure you want to delete the entire chat history? This action cannot be undone.")) {
            triggerHaptic('HEAVY');
            onClearChatHistory();
        }
    };

    return (
        <div className="space-y-6 animate-fade-in p-6">
            <fieldset>
                <legend className="text-base font-medium text-text-primary mb-3">App Settings</legend>

                {/* Auto-Play Audio */}
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <p className="text-sm font-medium text-text-primary">Auto-Play Audio</p>
                        <p className="text-xs text-text-secondary">Automatically play audio responses.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            checked={autoPlayAudio}
                            onChange={(e) => {
                                onAutoPlayAudioChange(e.target.checked);
                                triggerHaptic();
                            }}
                            className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-surface peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                    </label>
                </div>

                {/* Save Meeting Audio */}
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <p className="text-sm font-medium text-text-primary">Save Meeting Audio</p>
                        <p className="text-xs text-text-secondary">Keep the original audio recordings of meetings on the device to enable Tap-to-Play.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            checked={saveMeetingAudio}
                            onChange={(e) => {
                                onSaveMeetingAudioChange(e.target.checked);
                                triggerHaptic();
                            }}
                            className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-surface peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                    </label>
                </div>

                {/* Notification Vibration */}
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <p className="text-sm font-medium text-text-primary">Notification Vibration</p>
                        <p className="text-xs text-text-secondary">Enable vibration for app notifications.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            checked={enableNotificationVibration}
                            onChange={(e) => {
                                onEnableNotificationVibrationChange(e.target.checked);
                                triggerHaptic();
                            }}
                            className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-surface peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                    </label>
                </div>

                {/* Debug Logging */}
                <DebugLoggingToggle />

                <PerformanceSettings />


                {/* System Monitor */}
                <div className="bg-surface/30 p-4 rounded-lg border border-white/5 mb-4">
                    <div className="flex items-center justify-between mb-3">
                        <div>
                            <p className="text-sm font-medium text-text-primary">System Monitor</p>
                            <p className="text-xs text-text-secondary">Show CPU & RAM usage overlay.</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={enableSystemMonitor}
                                onChange={(e) => {
                                    onEnableSystemMonitorChange(e.target.checked);
                                    triggerHaptic();
                                }}
                                className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-surface peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
                        </label>
                    </div>

                    {enableSystemMonitor && (
                        <div className="mt-2 animate-fade-in space-y-3">
                            <div className="grid grid-cols-2 gap-2 mb-2">
                                <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer bg-black/20 p-2 rounded hover:bg-black/30 transition-colors">
                                    <input
                                        type="checkbox"
                                        checked={showRam}
                                        onChange={(e) => { onShowRamChange(e.target.checked); triggerHaptic(); }}
                                        className="rounded border-white/20 bg-surface/50 text-primary focus:ring-primary/50"
                                    />
                                    <span>RAM Usage</span>
                                </label>
                                <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer bg-black/20 p-2 rounded hover:bg-black/30 transition-colors">
                                    <input
                                        type="checkbox"
                                        checked={showAppRam}
                                        onChange={(e) => { onShowAppRamChange(e.target.checked); triggerHaptic(); }}
                                        className="rounded border-white/20 bg-surface/50 text-primary focus:ring-primary/50"
                                    />
                                    <span>App Memory</span>
                                </label>
                                <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer bg-black/20 p-2 rounded hover:bg-black/30 transition-colors">
                                    <input
                                        type="checkbox"
                                        checked={showCpu}
                                        onChange={(e) => { onShowCpuChange(e.target.checked); triggerHaptic(); }}
                                        className="rounded border-white/20 bg-surface/50 text-primary focus:ring-primary/50"
                                    />
                                    <span>App CPU</span>
                                </label>
                                <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer bg-black/20 p-2 rounded hover:bg-black/30 transition-colors">
                                    <input
                                        type="checkbox"
                                        checked={showGpu}
                                        onChange={(e) => { onShowGpuChange(e.target.checked); triggerHaptic(); }}
                                        className="rounded border-white/20 bg-surface/50 text-primary focus:ring-primary/50"
                                    />
                                    <span>GPU Usage</span>
                                </label>
                            </div>

                            <div className="flex justify-between items-center mb-1">
                                <label className="text-xs text-text-secondary">Update Frequency</label>
                                <span className="text-xs font-mono text-primary">{systemMonitorFrequency} ms</span>
                            </div>
                            <input
                                type="range"
                                min="500"
                                max="5000"
                                step="100"
                                value={systemMonitorFrequency}
                                onChange={(e) => {
                                    onSystemMonitorFrequencyChange(parseInt(e.target.value));
                                }}
                                className="w-full accent-primary h-1 bg-surface rounded-lg appearance-none cursor-pointer"
                            />
                            <div className="flex justify-between text-[10px] text-text-tertiary mt-1">
                                <span>Fast (0.5s)</span>
                                <span>Slow (5s)</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* File Storage Summary */}
                <div className="bg-surface/30 p-4 rounded-lg border border-white/5 mb-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-text-primary">📂 File Storage</p>
                            <p className="text-xs text-text-secondary">Manage downloaded models and voices.</p>
                        </div>
                        <div className="text-[10px] px-2 py-1 rounded bg-primary/10 text-primary border border-primary/20 font-bold uppercase tracking-wider">
                            v2.5.1
                        </div>
                    </div>
                    <p className="text-[10px] text-text-tertiary mt-2">
                        Use the "File Storage" tab in settings to view detailed disk usage and clean up space.
                    </p>
                </div>

                {/* Do Not Disturb (DND) */}
                <div className="bg-surface/30 p-4 rounded-lg border border-white/5 mb-4">
                    <div className="flex items-center justify-between mb-3">
                        <div>
                            <p className="text-sm font-medium text-text-primary">🌙 Do Not Disturb</p>
                            <p className="text-xs text-text-secondary">Silence proactive notifications at specific times.</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={enableDnd}
                                onChange={(e) => {
                                    onEnableDndChange(e.target.checked);
                                    triggerHaptic();
                                }}
                                className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-surface peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-500"></div>
                        </label>
                    </div>

                    {enableDnd && (
                        <div className="flex items-center gap-4 mt-2 animate-fade-in">
                            <div className="flex-1">
                                <label className="block text-xs text-text-secondary mb-1">Start (e.g., 22:00)</label>
                                <input
                                    type="time"
                                    value={dndStart}
                                    onChange={(e) => onDndStartChange(e.target.value)}
                                    className="w-full bg-input border-surface rounded px-2 py-1 text-sm text-text-primary focus:ring-1 focus:ring-indigo-500"
                                />
                            </div>
                            <div className="flex-1">
                                <label className="block text-xs text-text-secondary mb-1">End (e.g., 07:00)</label>
                                <input
                                    type="time"
                                    value={dndEnd}
                                    onChange={(e) => onDndEndChange(e.target.value)}
                                    className="w-full bg-input border-surface rounded px-2 py-1 text-sm text-text-primary focus:ring-1 focus:ring-indigo-500"
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Response Style */}
                <div className="mb-4">
                    <label className="text-base font-medium text-text-primary mb-2 block">Response Style</label>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => { triggerHaptic(); onResponseStyleChange('concise'); }}
                            className={`flex-1 py-3 px-4 rounded-lg border transition-all flex flex-col items-center gap-1
                            ${responseStyle === 'concise'
                                    ? 'bg-purple-500/20 border-purple-400 text-purple-300'
                                    : 'bg-surface border-white/10 text-text-secondary hover:border-white/20'}`}
                        >
                            <span className="text-xl">💬</span>
                            <span className="text-sm font-medium">Concise</span>
                            <span className="text-xs opacity-70">1-3 sentences</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => { triggerHaptic(); onResponseStyleChange('normal'); }}
                            className={`flex-1 py-3 px-4 rounded-lg border transition-all flex flex-col items-center gap-1
                            ${responseStyle === 'normal'
                                    ? 'bg-purple-500/20 border-purple-400 text-purple-300'
                                    : 'bg-surface border-white/10 text-text-secondary hover:border-white/20'}`}
                        >
                            <span className="text-xl">📝</span>
                            <span className="text-sm font-medium">Normal</span>
                            <span className="text-xs opacity-70">Balanced</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => { triggerHaptic(); onResponseStyleChange('detailed'); }}
                            className={`flex-1 py-3 px-4 rounded-lg border transition-all flex flex-col items-center gap-1
                            ${responseStyle === 'detailed'
                                    ? 'bg-purple-500/20 border-purple-400 text-purple-300'
                                    : 'bg-surface border-white/10 text-text-secondary hover:border-white/20'}`}
                        >
                            <span className="text-xl">📖</span>
                            <span className="text-sm font-medium">Detailed</span>
                            <span className="text-xs opacity-70">Thorough</span>
                        </button>
                    </div>
                </div>

                {/* Software Update */}
                <div className="bg-primary/5 p-4 rounded-lg border border-primary/20 mb-6">
                    <div className="flex items-center justify-between mb-3">
                        <div>
                            <p className="text-sm font-medium text-text-primary">✨ Software Update</p>
                            <p className="text-xs text-text-secondary">Keep AIMindMesh Mobile updated.</p>
                        </div>
                        <button 
                            onClick={() => checkUpdates(false)}
                            disabled={updateStatus.isLoading}
                            className="text-xs font-bold text-primary bg-primary/10 px-3 py-1.5 rounded-full border border-primary/20 hover:bg-primary/20 transition-all flex items-center gap-2"
                        >
                            {updateStatus.isLoading ? 'Checking...' : 'Check now'}
                        </button>
                    </div>

                    <div className="flex items-center justify-between mb-4">
                        <span className="text-xs text-text-secondary italic">Auto-check updates</span>
                        <label className="relative inline-flex items-center cursor-pointer scale-75">
                            <input
                                type="checkbox"
                                checked={autoCheckUpdates}
                                onChange={(e) => {
                                    onAutoCheckUpdatesChange(e.target.checked);
                                    triggerHaptic();
                                }}
                                className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-surface peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                        </label>
                    </div>

                    {updateStatus.error && (
                        <p className="text-[10px] text-red-400 bg-red-400/5 p-2 rounded border border-red-400/10">
                            ⚠️ {updateStatus.error}
                        </p>
                    )}

                    {updateStatus.latestVersion && !updateStatus.isNewer && !updateStatus.error && (
                        <p className="text-[10px] text-green-400 bg-green-400/5 p-2 rounded border border-green-400/10 flex items-center gap-2">
                            ✅ Running latest version
                        </p>
                    )}

                    {updateStatus.isNewer && (
                        <div className="bg-primary/10 p-3 rounded border border-primary/30 animate-pulse-subtle">
                            <p className="text-xs font-bold text-primary mb-2">New Update: v{updateStatus.latestVersion}</p>
                            {updateStatus.apk && (
                                <a 
                                    href={`${(aimindmeshServer?.serverUrl || '').replace(/\/$/, '')}/dl/${updateStatus.apk}`}
                                    className="w-full py-2 px-4 bg-primary text-white rounded-lg text-xs font-bold text-center block transition-transform active:scale-95"
                                >
                                    🚀 Download Latest APK
                                </a>
                            )}
                        </div>
                    )}
                </div>

                <div className="border-t border-white/10 my-4"></div>

                <div className="space-y-3">
                    <button
                        onClick={handleClearHistory}
                        className="w-full py-2 px-4 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-500 rounded-lg text-sm font-medium transition-colors"
                    >
                        Delete Chat History
                    </button>
                </div>
            </fieldset>
        </div>
    );
};

export default AppSettings;
