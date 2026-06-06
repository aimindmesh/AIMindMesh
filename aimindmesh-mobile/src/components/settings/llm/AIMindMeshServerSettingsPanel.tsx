/**
 * AIMindMeshServerSettings.tsx (v4.0.0)
 * Settings panel for the AIMindMesh Server integration.
 * Rendered inside LLMSettings when the server tab is active.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { AIMindMeshServerSettings as ServerSettingsType, FallbackProvider } from '../../../types';
import { testServerConnection, fetchServerVersion, fetchServerStats, fetchServerFcmLogs, fetchServerNodes, updateDeviceSettings, ServerStats, FcmLog, ServerNode } from '../../../services/llm/providers/serverProvider';
import { triggerHaptic } from '../../../services/native';
import { forceRegisterToken, FCMCapacitor } from '../../../services/fcmService';
import { logger } from '../../../services/logger';
import { nodeWorker } from '../../../services/worker/NodeWorker';

interface Props {
    settings: ServerSettingsType;
    onChange: (settings: ServerSettingsType) => void;
    isSyncing?: boolean;
    onSync?: () => void;
}

const FALLBACK_OPTIONS: { value: FallbackProvider; label: string }[] = [
    { value: 'native-gguf', label: 'On-device GGUF (llama.cpp)' },
    { value: 'litert', label: 'On-device LiteRT' },
    { value: 'gemini', label: 'Gemini (Cloud)' },
    { value: 'perplexity', label: 'Perplexity (Cloud)' },
    { value: 'none', label: 'None (show error)' },
];

const AIMindMeshServerSettingsPanel: React.FC<Props> = ({ settings, onChange, isSyncing, onSync }) => {
    const [testStatus, setTestStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
    const [testMessage, setTestMessage] = useState('');
    const [stats, setStats] = useState<ServerStats | null>(null);
    const [fcmLogs, setFcmLogs] = useState<FcmLog[]>([]);
    const [nodes, setNodes] = useState<ServerNode[]>([]);
    const [isLoadingAdmin, setIsLoadingAdmin] = useState(false);
    const [localToken, setLocalToken] = useState<string | null>(null);
    const [isRegistering, setIsRegistering] = useState(false);
    const [isWorkerActive, setIsWorkerActive] = useState(nodeWorker.isWorking);
    const [unsyncedCount, setUnsyncedCount] = useState<number | null>(null);

    useEffect(() => {
        nodeWorker.onStatusChange(setIsWorkerActive);
        return () => nodeWorker.removeStatusListener(setIsWorkerActive);
    }, []);

    useEffect(() => {
        if (settings.enabled && settings.serverUrl && settings.apiKey) {
            refreshAdminData();
        }
    }, [settings.enabled, settings.serverUrl]);

    useEffect(() => {
        if (settings.enabled) {
            refreshUnsyncedCount();
        }
    }, [settings.enabled, isSyncing]);

    const refreshUnsyncedCount = async () => {
        try {
            const { getMeetingDatabase } = await import('../../../services/database/meetingDatabase');
            const { getKnowledgeDatabase } = await import('../../../services/database/knowledgeDatabase');
            const { getMemoryDatabase } = await import('../../../services/memory/memoryDatabase');

            const mdb = await getMeetingDatabase();
            const kdb = await getKnowledgeDatabase();
            const memdb = await getMemoryDatabase();

            const [mRes, sRes, dRes, memRes] = await Promise.all([
                mdb.query('SELECT COUNT(*) as count FROM meetings WHERE is_synced = 0'),
                mdb.query('SELECT COUNT(*) as count FROM meeting_segments WHERE is_synced = 0'),
                kdb.query('SELECT COUNT(*) as count FROM documents WHERE is_synced = 0'),
                memdb.query('SELECT COUNT(*) as count FROM memories WHERE is_synced = 0')
            ]);

            const total = (mRes.values?.[0]?.count || 0) + 
                          (sRes.values?.[0]?.count || 0) + 
                          (dRes.values?.[0]?.count || 0) + 
                          (memRes.values?.[0]?.count || 0);
            
            setUnsyncedCount(total);
        } catch (e) {
            console.error('Failed to refresh unsynced count:', e);
            setUnsyncedCount(null);
        }
    };

    // Token detection
    useEffect(() => {
        if (typeof (window as any).Capacitor !== 'undefined') {
            FCMCapacitor.getFCMToken()
                .then(res => setLocalToken(res.token))
                .catch(() => setLocalToken(null));
        }
    }, []);

    // Auto-refresh logic
    useEffect(() => {
        if (!settings.enabled || !settings.autoRefreshResources || !settings.serverUrl) return;

        const interval = setInterval(() => {
            refreshAdminData();
        }, (settings.resourceRefreshInterval || 30) * 1000);

        return () => clearInterval(interval);
    }, [settings.enabled, settings.autoRefreshResources, settings.resourceRefreshInterval, settings.serverUrl]);

    const refreshAdminData = async () => {
        setIsLoadingAdmin(true);
        try {
            const [s, logs, ns] = await Promise.all([
                fetchServerStats(settings),
                fetchServerFcmLogs(settings, 10),
                fetchServerNodes(settings)
            ]);
            setStats(s);
            setFcmLogs(logs);
            setNodes(ns);
        } finally {
            setIsLoadingAdmin(false);
        }
    };

    const update = useCallback((partial: Partial<ServerSettingsType>) => {
        onChange({ ...settings, ...partial });
    }, [settings, onChange]);

    const handleTest = async () => {
        if (!settings.serverUrl) {
            setTestStatus('error');
            setTestMessage('Server URL is required');
            return;
        }
        setTestStatus('loading');
        setTestMessage('');
        try {
            const node = await testServerConnection(settings);
            const version = await fetchServerVersion(settings);
            setTestStatus('ok');
            setTestMessage(`✅ Connected as ${settings.deviceName || 'Mobile Device'} — Node: ${node}${version ? ` · v${version}` : ''}`);
            if (version) update({ serverVersion: version });
            // Refresh admin data immediately on successful test if enabled
            refreshAdminData();
        } catch (e: any) {
            setTestStatus('error');
            setTestMessage(`❌ ${e?.message ?? 'Connection failed'}`);
        }
    };

    const handleForceRegister = async () => {
        setIsRegistering(true);
        triggerHaptic('MEDIUM');
        try {
            await forceRegisterToken(settings);
            const res = await FCMCapacitor.getFCMToken();
            setLocalToken(res.token);
            alert('FCM Registration token refreshed and sent to server.');
            refreshAdminData();
        } catch (e: any) {
            logger.log('error', '[Settings] FCM Force registration failed', e);
            alert(`Failed to refresh token: ${e.message}`);
        } finally {
            setIsRegistering(false);
        }
    };

    const rowCls = 'flex flex-col gap-1 mb-4';
    const labelCls = 'text-sm font-medium text-text-secondary';
    const inputCls = 'w-full bg-input border border-surface/40 rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-primary/50 transition-colors placeholder:text-text-secondary/40';
    const toggleCls = 'relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer';

    return (
        <div className="space-y-2">
            {/* Master toggle */}
            <div className="flex items-center justify-between mb-5">
                <div>
                    <div className="font-semibold text-text-primary">Enable Server Integration</div>
                    <div className="text-xs text-text-secondary mt-0.5">Connect to your AIMindMesh Server for distributed AI</div>
                </div>
                <button
                    id="server-integration-toggle"
                    onClick={() => update({ enabled: !settings.enabled })}
                    className={`${toggleCls} ${settings.enabled ? 'bg-primary' : 'bg-white/20'}`}
                    aria-pressed={settings.enabled}
                >
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${settings.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
            </div>

            {/* Device Name */}
            <div className={rowCls}>
                <label className={labelCls} htmlFor="server-device-name-input">Device Name (how you appear in Admin Panel)</label>
                <input
                    id="server-device-name-input"
                    type="text"
                    className={inputCls}
                    placeholder="My Android Phone"
                    value={settings.deviceName}
                    onChange={e => update({ deviceName: e.target.value })}
                    disabled={!settings.enabled}
                />
            </div>

            {/* Server URL */}
            <div className={rowCls}>
                <label className={labelCls} htmlFor="server-url-input">Server URL</label>
                <input
                    id="server-url-input"
                    type="url"
                    className={inputCls}
                    placeholder="http://10.2.0.1:3030"
                    value={settings.serverUrl}
                    onChange={e => update({ serverUrl: e.target.value })}
                    disabled={!settings.enabled}
                />
            </div>

            {/* API Key */}
            <div className={rowCls}>
                <label className={labelCls} htmlFor="server-api-key-input">API Key</label>
                <input
                    id="server-api-key-input"
                    type="password"
                    className={inputCls}
                    placeholder="Your node API key"
                    value={settings.apiKey}
                    onChange={e => update({ apiKey: e.target.value })}
                    disabled={!settings.enabled}
                />
            </div>

            {/* Use as default */}
            <div className="flex items-center justify-between mb-4">
                <div>
                    <div className="text-sm font-medium text-text-primary">Use as Default LLM Provider</div>
                    <div className="text-xs text-text-secondary mt-0.5">AI will route all chat messages to your server</div>
                </div>
                <button
                    id="server-default-toggle"
                    onClick={() => update({ useAsDefaultProvider: !settings.useAsDefaultProvider })}
                    className={`${toggleCls} ${settings.useAsDefaultProvider && settings.enabled ? 'bg-primary' : 'bg-white/20'}`}
                    disabled={!settings.enabled}
                    aria-pressed={settings.useAsDefaultProvider}
                >
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${settings.useAsDefaultProvider && settings.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
            </div>

            {/* Participate as worker */}
            <div className="flex items-center justify-between mb-4">
                <div>
                    <div className="text-sm font-medium text-text-primary">Participate as Worker Node</div>
                    <div className="text-xs text-text-secondary mt-0.5">Allow other mesh nodes to route tasks to this device</div>
                </div>
                <button
                    id="server-worker-toggle"
                    onClick={() => update({ participateAsWorker: !settings.participateAsWorker })}
                    className={`${toggleCls} ${settings.participateAsWorker && settings.enabled ? 'bg-primary' : 'bg-white/20'}`}
                    disabled={!settings.enabled}
                    aria-pressed={settings.participateAsWorker}
                >
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${settings.participateAsWorker && settings.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
            </div>

            {/* Mesh Worker Status */}
            {settings.participateAsWorker && settings.enabled && (
                <div className={`mb-4 p-4 rounded-xl border transition-all duration-500 ${isWorkerActive ? 'bg-orange-500/10 border-orange-500/30 animate-pulse' : 'bg-surface/30 border-white/5'}`}>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className={`w-2.5 h-2.5 rounded-full ${isWorkerActive ? 'bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.8)]' : 'bg-green-500/40'}`} />
                            <div>
                                <div className="text-sm font-bold text-text-primary">Mesh Activity</div>
                                <div className="text-[10px] text-text-secondary">
                                    {isWorkerActive ? 'EXECUTING DISTRIBUTED TASK...' : 'READY FOR TASKS'}
                                </div>
                            </div>
                        </div>
                        {isWorkerActive && (
                            <div className="flex gap-1">
                                <div className="w-1 h-3 bg-orange-500/40 rounded-full animate-bounce [animation-delay:-0.3s]" />
                                <div className="w-1 h-4 bg-orange-500/60 rounded-full animate-bounce [animation-delay:-0.15s]" />
                                <div className="w-1 h-3 bg-orange-500/40 rounded-full animate-bounce" />
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Preferred Routing Target */}
            <div className={rowCls}>
                <label className={labelCls} htmlFor="server-preferred-node-select">Preferred Routing Target</label>
                <div className="relative">
                    <select
                        id="server-preferred-node-select"
                        className={`${inputCls} appearance-none pr-10`}
                        value={settings.preferredNode || 'AUTO'}
                        onChange={e => {
                            update({ preferredNode: e.target.value });
                            triggerHaptic('LIGHT');
                        }}
                        disabled={!settings.enabled}
                    >
                        <option value="AUTO">AUTO (Smart Load Balancing)</option>
                        <option value="LAPTOP">LAPTOP (Primary PC)</option>
                        <option value="SERVER_LOCAL">SERVER (Ollama Local)</option>
                        <option value="GEMINI">GEMINI (Google Cloud)</option>
                        <option value="OPENROUTER">OPENROUTER (Aggregator)</option>
                        {nodes.filter(n => n.type === 'mobile' && n.id !== (settings.deviceName || '').toUpperCase()).map(n => (
                            <option key={n.id} value={n.id}>
                                📱 {n.id} {n.status === 'ONLINE' ? '(Online)' : '(Offline)'}
                            </option>
                        ))}
                    </select>
                    <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
                        <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                    </div>
                </div>
                {settings.preferredNode && settings.preferredNode !== 'AUTO' && (
                    <div className="mt-1 flex items-center gap-1.5">
                        <div className={`w-1.5 h-1.5 rounded-full ${
                            nodes.find(n => n.id === settings.preferredNode)?.status === 'ONLINE' 
                            ? 'bg-green-500' 
                            : 'bg-red-500 animate-pulse'
                        }`} />
                        <span className="text-[10px] text-text-tertiary">
                            {nodes.find(n => n.id === settings.preferredNode)?.status === 'ONLINE' 
                                ? 'Target is online and ready' 
                                : 'Warning: Target node is currently offline'}
                        </span>
                    </div>
                )}
            </div>

            {/* Fallback provider */}
            <div className={rowCls}>
                <label className={labelCls} htmlFor="server-fallback-select">Fallback Provider (when server unreachable)</label>
                <select
                    id="server-fallback-select"
                    className={inputCls}
                    value={settings.fallbackProvider}
                    onChange={e => update({ fallbackProvider: e.target.value as FallbackProvider })}
                    disabled={!settings.enabled}
                >
                    {FALLBACK_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                </select>
            </div>
            
            {/* Delivery Mode Toggle */}
            <div className="flex items-center justify-between mb-4 mt-2 bg-purple-500/5 p-3 rounded-lg border border-purple-500/20">
                <div>
                    <div className="text-sm font-bold text-text-primary">Delivery Mode</div>
                    <div className="text-[10px] text-text-secondary mt-0.5">
                        {settings.deliveryMode === 'CONTEXTUAL' 
                            ? 'PULL: Insight only when device is available' 
                            : 'PUSH: Deliver insights immediately via FCM'}
                    </div>
                </div>
                <div className="flex bg-surface/80 rounded-lg p-0.5 border border-white/10">
                    <button
                        onClick={async () => {
                            triggerHaptic('LIGHT');
                            update({ deliveryMode: 'PUSH' });
                            try {
                                if (settings.enabled && settings.serverUrl) {
                                    await updateDeviceSettings(settings, { deliveryMode: 'PUSH' });
                                }
                            } catch (e) {
                                logger.log('error', '[Settings] Failed to sync PUSH mode', e);
                            }
                        }}
                        className={`px-3 py-1.5 rounded text-[10px] font-bold transition-all ${settings.deliveryMode !== 'CONTEXTUAL' ? 'bg-primary text-white shadow-sm' : 'text-text-tertiary hover:text-text-primary'}`}
                    >
                        PUSH
                    </button>
                    <button
                        onClick={async () => {
                            triggerHaptic('MEDIUM');
                            update({ deliveryMode: 'CONTEXTUAL' });
                            try {
                                if (settings.enabled && settings.serverUrl) {
                                    await updateDeviceSettings(settings, { deliveryMode: 'CONTEXTUAL' });
                                }
                            } catch (e) {
                                logger.log('error', '[Settings] Failed to sync CONTEXTUAL mode', e);
                            }
                        }}
                        className={`px-3 py-1.5 rounded text-[10px] font-bold transition-all ${settings.deliveryMode === 'CONTEXTUAL' ? 'bg-primary text-white shadow-sm' : 'text-text-tertiary hover:text-text-primary'}`}
                    >
                        PULL
                    </button>
                </div>
            </div>

            {/* Auto-Refresh Resources */}
            <div className="flex items-center justify-between mb-4 mt-2">
                <div>
                    <div className="text-sm font-medium text-text-primary">Auto-Refresh Admin Status</div>
                    <div className="text-xs text-text-secondary mt-0.5">Periodically poll server for live stats & nodes</div>
                </div>
                <button
                    id="server-auto-refresh-toggle"
                    onClick={() => update({ autoRefreshResources: !settings.autoRefreshResources })}
                    className={`${toggleCls} ${settings.autoRefreshResources && settings.enabled ? 'bg-primary' : 'bg-white/20'}`}
                    disabled={!settings.enabled}
                    aria-pressed={settings.autoRefreshResources}
                >
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${settings.autoRefreshResources && settings.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
            </div>

            {settings.autoRefreshResources && (
                <div className="mb-4 animate-fade-in pl-4 border-l-2 border-primary/20">
                    <div className="flex justify-between items-center mb-1">
                        <label className="text-xs text-text-secondary">Admin Refresh Interval</label>
                        <span className="text-xs font-mono text-primary">{settings.resourceRefreshInterval} s</span>
                    </div>
                    <input
                        type="range"
                        min="5"
                        max="60"
                        step="5"
                        value={settings.resourceRefreshInterval || 30}
                        onChange={(e) => update({ resourceRefreshInterval: parseInt(e.target.value) })}
                        className="w-full accent-primary h-1 bg-surface rounded-lg appearance-none cursor-pointer"
                    />
                </div>
            )}

            {/* AI Task Polling Interval */}
            <div className="mt-4 mb-2">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="text-sm font-medium text-text-primary">AI Task Polling Interval</div>
                        <div className="text-xs text-text-secondary mt-0.5">Frequency for checking task status in Detail view</div>
                    </div>
                </div>
                <div className="mt-2 animate-fade-in pl-4 border-l-2 border-indigo-500/20">
                    <div className="flex justify-between items-center mb-1">
                        <label className="text-xs text-text-secondary">Interval</label>
                        <span className="text-xs font-mono text-indigo-400">{settings.aiTaskPollingInterval || 15} s</span>
                    </div>
                    <input
                        type="range"
                        min="5"
                        max="60"
                        step="5"
                        value={settings.aiTaskPollingInterval || 15}
                        onChange={(e) => update({ aiTaskPollingInterval: parseInt(e.target.value) })}
                        className="w-full accent-indigo-500 h-1 bg-surface rounded-lg appearance-none cursor-pointer"
                    />
                </div>
            </div>

            {/* AI Task Retention Limit */}
            <div className="mt-4 mb-2">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="text-sm font-medium text-text-primary">AI Task Database Retention</div>
                        <div className="text-xs text-text-secondary mt-0.5">Max archived task outputs to keep (0 = infinite)</div>
                    </div>
                </div>
                <div className="mt-2 animate-fade-in pl-4 border-l-2 border-teal-500/20">
                    <div className="flex justify-between items-center mb-1">
                        <label className="text-xs text-text-secondary">Keep latest</label>
                        <span className="text-xs font-mono text-teal-400">{settings.taskRetentionLimit || 50} outputs</span>
                    </div>
                    <input
                        type="range"
                        min="0"
                        max="200"
                        step="10"
                        value={settings.taskRetentionLimit || 50}
                        onChange={(e) => update({ taskRetentionLimit: parseInt(e.target.value) })}
                        className="w-full accent-teal-500 h-1 bg-surface rounded-lg appearance-none cursor-pointer"
                    />
                </div>
            </div>



            {/* Test Connection */}
            <div className="flex items-center gap-3 mt-2">
                <button
                    id="server-test-connection-btn"
                    onClick={handleTest}
                    disabled={!settings.enabled || testStatus === 'loading'}
                    className="flex-1 py-2 rounded-lg bg-gradient-to-r from-primary to-purple-600 text-white text-sm font-medium hover:opacity-90 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    {testStatus === 'loading' ? 'Testing…' : 'Test Connection'}
                </button>
            </div>

            {testMessage && (
                <div className={`mt-2 text-xs rounded-lg px-3 py-2 border ${testStatus === 'ok' ? 'bg-input border-green-500/20 text-green-500' : 'bg-input border-red-500/20 text-red-500'}`}>
                    {testMessage}
                </div>
            )}

            {/* Server version chip */}
            {settings.serverVersion && settings.enabled && (
                <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-text-secondary">Server version:</span>
                        <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-mono">
                            v{settings.serverVersion}
                        </span>
                    </div>
                    <button
                        onClick={() => { triggerHaptic(); refreshAdminData(); }}
                        disabled={isLoadingAdmin}
                        className="p-1 hover:bg-white/5 rounded-lg transition-colors"
                        title="Refresh Admin Data"
                    >
                        <svg className={`w-3.5 h-3.5 text-text-secondary ${isLoadingAdmin ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    </button>
                </div>
            )}

            {/* Advanced Management Section */}
            {settings.enabled && (
                <div className="mt-8 border-t border-white/5 pt-6 space-y-6 animate-fade-in">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-bold text-text-primary uppercase tracking-wider">🛠️ Advanced Management</span>
                    </div>

                    {/* Server Stats */}
                    {stats && (
                        <div className="grid grid-cols-2 gap-3">
                            <div className="p-3 bg-surface/30 rounded-lg border border-white/5">
                                <p className="text-[10px] text-text-secondary uppercase mb-1">CPU Load</p>
                                <p className="text-sm font-bold text-text-primary">{stats.cpu}%</p>
                            </div>
                            <div className="p-3 bg-surface/30 rounded-lg border border-white/5">
                                <p className="text-[10px] text-text-secondary uppercase mb-1">RAM Usage</p>
                                <p className="text-sm font-bold text-text-primary">{stats.ram?.percent}%</p>
                            </div>
                        </div>
                    )}

                    {/* Active Nodes */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <p className={labelCls}>Active Nodes ({nodes.length})</p>
                        </div>
                        <div className="bg-surface/30 rounded-lg border border-white/5 overflow-hidden">
                            {nodes.length === 0 ? (
                                <div className="p-4 text-center text-xs text-text-secondary opacity-50">No nodes reporting</div>
                            ) : nodes.map(n => (
                                <div key={n.id} className="p-3 flex items-center justify-between border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors">
                                    <div className="flex flex-col min-w-0 flex-1">
                                        <span className="text-xs font-semibold text-text-primary truncate">{n.id}</span>
                                        <span className="text-[10px] text-text-secondary uppercase truncate">{n.type} · {n.status}</span>
                                        {n.id === settings.deviceName?.toUpperCase() && (
                                            <span className="text-[9px] text-primary font-bold mt-0.5">THIS DEVICE</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-3">
                                        {n.fcm_token && <span className="text-[9px] px-1 bg-green-500/10 text-green-500 rounded border border-green-500/20 font-bold">FCM READY</span>}
                                        {!n.fcm_token && n.type === 'mobile' && <span className="text-[9px] px-1 bg-amber-500/10 text-amber-500 rounded border border-amber-500/20 font-bold">MISSING TOKEN</span>}
                                        <div className={`w-2 h-2 rounded-full shrink-0 ${n.status === 'ONLINE' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-red-500'}`}></div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* FCM Token Visibility & Refresh */}
                    <div className="space-y-3 bg-primary/5 p-4 rounded-xl border border-primary/10">
                        <div className="flex items-center justify-between">
                            <p className="text-xs font-bold text-primary uppercase tracking-tight">Firebase Registration</p>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${localToken ? 'bg-green-500/20 text-green-400' : 'bg-amber-500/20 text-amber-500'}`}>
                                {localToken ? 'TOKEN DETECTED' : 'MISSING TOKEN'}
                            </span>
                        </div>
                        
                        <div className="bg-black/20 p-2.5 rounded-lg border border-white/5">
                            <p className="text-[9px] text-text-tertiary uppercase mb-1">Local FCM Token</p>
                            <p className="text-[10px] font-mono text-text-secondary break-all leading-relaxed">
                                {localToken ? `${localToken.substring(0, 40)}...` : 'Not generated yet. Ensure you are on a real device and granted notification permissions.'}
                            </p>
                        </div>

                        <button
                            onClick={handleForceRegister}
                            disabled={isRegistering || !settings.enabled}
                            className="w-full py-2 bg-primary/20 hover:bg-primary/30 border border-primary/30 text-primary rounded-lg text-[11px] font-bold transition-all disabled:opacity-30 flex items-center justify-center gap-2"
                        >
                            {isRegistering ? (
                                <>
                                    <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                                    Synchronizing with Gateway...
                                </>
                            ) : (
                                <>
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                    Force Refresh & Sync Token
                                </>
                            )}
                        </button>
                    </div>

                    {/* FCM Logs */}
                    <div className="space-y-2">
                        <p className={labelCls}>Recent FCM Telegrams</p>
                        <div className="bg-surface/30 rounded-lg border border-white/5 overflow-hidden">
                            {fcmLogs.length === 0 ? (
                                <div className="p-4 text-center text-xs text-text-secondary opacity-50">No recent logs</div>
                            ) : fcmLogs.map(log => (
                                <div key={log.id} className="p-3 border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors">
                                    <div className="flex justify-between items-start mb-1">
                                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${log.status === 'SUCCESS' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                                            {log.status}
                                        </span>
                                        <span className="text-[9px] text-text-tertiary">
                                            {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                    <p className="text-xs text-text-primary truncate">{log.message}</p>
                                    <p className="text-[10px] text-text-secondary truncate mt-0.5">To: {log.recipient}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Cloud Sync & Shared Memory Section */}
                    <div className="mt-8 border-t border-white/5 pt-6 space-y-4">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="text-sm font-bold text-text-primary uppercase tracking-wider">☁️ Cloud Sync & Shared Memory</span>
                        </div>
                        
                        <div className="bg-gradient-to-br from-primary/10 to-purple-500/10 p-4 rounded-xl border border-primary/20">
                            <div className="flex items-center justify-between mb-3">
                                <div>
                                    <div className="text-sm font-bold text-text-primary">Ecosystem Sync</div>
                                    <div className="text-[10px] text-text-secondary">Keep meetings, chats, and knowledge aligned across devices</div>
                                </div>
                                <div className="text-[10px] font-mono text-primary/70">
                                    {localStorage.getItem('last_sync_timestamp') 
                                        ? `Last: ${new Date(parseInt(localStorage.getItem('last_sync_timestamp')!)).toLocaleTimeString()}`
                                        : 'Never synced'}
                                </div>
                            </div>

                            <button
                                onClick={() => { triggerHaptic('MEDIUM'); onSync?.(); }}
                                disabled={isSyncing || !settings.enabled || !settings.serverUrl}
                                className={`w-full py-3 rounded-xl flex items-center justify-center gap-3 transition-all ${
                                    isSyncing 
                                    ? 'bg-primary/20 text-primary cursor-not-allowed' 
                                    : 'bg-primary text-white shadow-lg shadow-primary/20 hover:opacity-90 active:scale-[0.98]'
                                }`}
                            >
                                {isSyncing ? (
                                    <>
                                        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                                        <span className="text-sm font-bold">Synchronizing Knowledge...</span>
                                    </>
                                ) : (
                                    <>
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                                        </svg>
                                        <span className="text-sm font-bold">Sync Now</span>
                                    </>
                                )}
                            </button>

                             <div className="mt-4 grid grid-cols-2 gap-2">
                                <div className="p-2 bg-black/20 rounded-lg border border-white/5 flex flex-col items-center">
                                    <span className="text-[9px] text-text-tertiary uppercase">Local Queue</span>
                                    <span className={`text-xs font-bold ${unsyncedCount === 0 ? 'text-green-500' : 'text-text-primary'}`}>
                                        {unsyncedCount === null ? '...' : (unsyncedCount === 0 ? 'CLEAN' : `${unsyncedCount} ITEMS`)}
                                    </span>
                                </div>
                                <div className="p-2 bg-black/20 rounded-lg border border-white/5 flex flex-col items-center">
                                    <span className="text-[9px] text-text-tertiary uppercase">Cloud Status</span>
                                    <span className={`text-xs font-bold ${testStatus === 'ok' ? 'text-green-500' : (testStatus === 'error' ? 'text-red-500' : 'text-text-secondary')}`}>
                                        {testStatus === 'ok' ? 'CONNECTED' : (testStatus === 'loading' ? 'WAITING...' : 'OFFLINE')}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AIMindMeshServerSettingsPanel;
