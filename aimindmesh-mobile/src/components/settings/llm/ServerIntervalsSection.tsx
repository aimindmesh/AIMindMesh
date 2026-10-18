/**
 * Polling settings of the AIMindMesh Server panel: admin status auto-refresh, AI task polling
 * and how many finished tasks the server keeps.
 */

import React from 'react';
import { AIMindMeshServerSettings } from '../../../types';

interface Props {
    settings: AIMindMeshServerSettings;
    update: (partial: Partial<AIMindMeshServerSettings>) => void;
}

const toggleCls = 'relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer';

const ServerIntervalsSection: React.FC<Props> = ({ settings, update }) => (
    <>
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
    </>
);

export default ServerIntervalsSection;
