
import React from 'react';
import { ProactiveSettings as ProactiveSettingsType } from '../../../types';
import { DEFAULT_PROACTIVE_SETTINGS } from '../../../types';

interface ProactiveSettingsProps {
    settings: ProactiveSettingsType;
    onSettingsChange: (settings: ProactiveSettingsType) => void;
}

const ProactiveSettings: React.FC<ProactiveSettingsProps> = ({ settings, onSettingsChange }) => {
    // Ensure we have valid settings (handle missing fields if any)
    const safeSettings = { ...DEFAULT_PROACTIVE_SETTINGS, ...settings };

    const handleChange = (key: keyof ProactiveSettingsType, value: any) => {
        onSettingsChange({ ...safeSettings, [key]: value });
    };

    const handleNestedChange = (parent: keyof ProactiveSettingsType, key: string, value: any) => {
        onSettingsChange({
            ...safeSettings,
            [parent]: {
                ...(safeSettings[parent] as any),
                [key]: value
            }
        });
    };

    return (
        <div className="space-y-8 animate-fade-in">

            {/* Master Switch */}
            <div className="bg-surface/30 p-4 rounded-xl border border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-full ${safeSettings.enabled ? 'bg-primary/20 text-primary' : 'bg-surface text-textSecondary'}`}>
                        <span className="text-xl">⚡</span>
                    </div>
                    <div>
                        <h3 className="font-semibold text-lg text-textPrimary">Proactive Assistant</h3>
                        <p className="text-sm text-textSecondary">Allow AI to act autonomously and provide suggestions</p>
                    </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                    <input
                        type="checkbox"
                        checked={safeSettings.enabled}
                        onChange={(e) => handleChange('enabled', e.target.checked)}
                        className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-surface rounded-full peer peer-focus:ring-4 peer-focus:ring-primary/30 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                </label>
            </div>

            {!safeSettings.enabled && (
                <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-200 text-sm flex items-center gap-2 mb-4">
                    <span>ℹ️</span>
                    <span>All proactive features are currently disabled.</span>
                </div>
            )}

            {/* Intelligence Source */}
            <div className="space-y-3">
                <h4 className="text-sm font-medium text-textSecondary uppercase tracking-wider flex items-center gap-2">
                    <span>🌐</span> Intelligence Source
                </h4>
                <div className="grid grid-cols-2 gap-2">
                    <button
                        onClick={() => handleChange('source', 'auto')}
                        disabled={!safeSettings.enabled}
                        className={`p-3 rounded-lg border text-sm flex flex-col items-center justify-center gap-1 transition-all ${safeSettings.source === 'auto'
                                ? 'bg-primary/20 border-primary text-textPrimary'
                                : 'bg-surface/50 border-transparent text-textSecondary hover:bg-surface hover:text-textPrimary'
                            } ${!safeSettings.enabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        <span className="font-semibold text-primary">Hybrid / Server Data</span>
                        <span className="text-[10px] text-center opacity-80">Uses AIMindMesh Server if available, falls back locally. Best battery & speed.</span>
                    </button>
                    <button
                        onClick={() => handleChange('source', 'local')}
                        disabled={!safeSettings.enabled}
                        className={`p-3 rounded-lg border text-sm flex flex-col items-center justify-center gap-1 transition-all ${safeSettings.source === 'local'
                                ? 'bg-green-500/10 border-green-500/40 text-textPrimary'
                                : 'bg-surface/50 border-transparent text-textSecondary hover:bg-surface hover:text-textPrimary'
                            } ${!safeSettings.enabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        <span className="font-semibold text-green-400">Strictly Local</span>
                        <span className="text-[10px] text-center opacity-80">Pure on-device inference. High battery usage. Total privacy.</span>
                    </button>
                </div>
            </div>

            {/* Aggressiveness */}
            <div className="space-y-3 opacity-90">
                <h4 className="text-sm font-medium text-textSecondary uppercase tracking-wider flex items-center gap-2">
                    <span>⚡</span> Activity Level
                </h4>
                <div className="grid grid-cols-4 gap-2">
                    {['minimal', 'balanced', 'proactive', 'very_proactive'].map((level) => (
                        <button
                            key={level}
                            onClick={() => handleChange('aggressiveness', level)}
                            disabled={!safeSettings.enabled}
                            className={`p-3 rounded-lg border text-sm font-medium transition-all ${safeSettings.aggressiveness === level
                                ? 'bg-primary/20 border-primary text-primary'
                                : 'bg-surface/50 border-transparent text-textSecondary hover:bg-surface hover:text-textPrimary'
                                } ${!safeSettings.enabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                            {level.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                        </button>
                    ))}
                </div>
            </div>

            {/* Permissions */}
            <div className="space-y-4">
                <h4 className="text-sm font-medium text-textSecondary uppercase tracking-wider flex items-center gap-2">
                    <span>🛡️</span> Permissions
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <PermissionToggle
                        label="Silent Actions"
                        desc="Background maintenance, preloading"
                        checked={safeSettings.permissions.silent}
                        onChange={(v: boolean) => handleNestedChange('permissions', 'silent', v)}
                        disabled={!safeSettings.enabled}
                    />
                    <PermissionToggle
                        label="Notifications"
                        desc="Status updates, informative alerts"
                        checked={safeSettings.permissions.informative}
                        onChange={(v: boolean) => handleNestedChange('permissions', 'informative', v)}
                        disabled={!safeSettings.enabled}
                    />
                    <PermissionToggle
                        label="Suggestions"
                        desc="In-app cards, helper tips"
                        checked={safeSettings.permissions.suggestive}
                        onChange={(v: boolean) => handleNestedChange('permissions', 'suggestive', v)}
                        disabled={!safeSettings.enabled}
                    />
                    <PermissionToggle
                        label="Autonomous Actions"
                        desc="Modify calendar, data without asking"
                        checked={safeSettings.permissions.autonomous}
                        onChange={(v: boolean) => handleNestedChange('permissions', 'autonomous', v)}
                        disabled={!safeSettings.enabled}
                        warning
                    />
                </div>
            </div>

            {/* Autonomous Calls Warning */}
            <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <div className="flex items-start gap-3">
                    <span className="text-xl">⚠️</span>
                    <div className="flex-1">
                        <h5 className="font-medium text-red-200 text-sm">Autonomous Voice Calls</h5>
                        <p className="text-xs text-red-200/70 mt-1 mb-3">
                            Enabling this allows the assistant to initiate voice calls without your confirmation.
                            This feature is experimental.
                        </p>
                        <PermissionToggle
                            label="Allow Autonomous Calls"
                            desc="Assistant can start voice interactions"
                            checked={safeSettings.permissions.autonomousCalls}
                            onChange={(v: boolean) => handleNestedChange('permissions', 'autonomousCalls', v)}
                            disabled={!safeSettings.enabled}
                            warning
                        />
                    </div>
                </div>
            </div>

            {/* Context Awareness */}
            <div className="space-y-4">
                <h4 className="text-sm font-medium text-textSecondary uppercase tracking-wider flex items-center gap-2">
                    <span>🔋</span> Context Awareness
                </h4>
                <div className="bg-surface/20 rounded-xl p-4 space-y-3 border border-white/5">
                    <CheckboxRow
                        label="Respect Focus Mode"
                        checked={safeSettings.contextAwareness.respectFocusMode}
                        onChange={(v: boolean) => handleNestedChange('contextAwareness', 'respectFocusMode', v)}
                        disabled={!safeSettings.enabled}
                    />
                    <CheckboxRow
                        label="Conserve Battery"
                        checked={safeSettings.contextAwareness.respectBatteryLevel}
                        onChange={(v: boolean) => handleNestedChange('contextAwareness', 'respectBatteryLevel', v)}
                        disabled={!safeSettings.enabled}
                    />
                    <CheckboxRow
                        label="Respect Data Usage"
                        checked={safeSettings.contextAwareness.respectDataUsage}
                        onChange={(v: boolean) => handleNestedChange('contextAwareness', 'respectDataUsage', v)}
                        disabled={!safeSettings.enabled}
                    />
                    <CheckboxRow
                        label="Learn from Behavior"
                        checked={safeSettings.contextAwareness.adaptToUserPattern}
                        onChange={(v: boolean) => handleNestedChange('contextAwareness', 'adaptToUserPattern', v)}
                        disabled={!safeSettings.enabled}
                    />
                    <CheckboxRow
                        label="Autonomous Memory Maintenance"
                        desc="Automatically deduplicate and summarize memories during idle periods"
                        checked={safeSettings.permissions.autonomous}
                        onChange={(v: boolean) => handleNestedChange('permissions', 'autonomous', v)}
                        disabled={!safeSettings.enabled}
                    />

                    {/* Context Summarization Controls */}
                    <div className="pt-3 border-t border-white/5 space-y-3">
                        <CheckboxRow
                            label="Auto-Summarize Context"
                            desc="Automatically compress older chat messages when context fills up"
                            checked={safeSettings.contextAwareness.enableAutoSummarization}
                            onChange={(v: boolean) => handleNestedChange('contextAwareness', 'enableAutoSummarization', v)}
                            disabled={!safeSettings.enabled}
                        />

                        {safeSettings.contextAwareness.enableAutoSummarization && (
                            <div className="ml-7 space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-xs text-textSecondary">Summarization Threshold</label>
                                    <span className="text-xs font-mono bg-surface px-2 py-0.5 rounded text-primary">
                                        {Math.round(safeSettings.contextAwareness.summarizationThreshold * 100)}%
                                    </span>
                                </div>
                                <input
                                    type="range"
                                    min="30"
                                    max="90"
                                    step="5"
                                    value={Math.round(safeSettings.contextAwareness.summarizationThreshold * 100)}
                                    onChange={(e) => handleNestedChange('contextAwareness', 'summarizationThreshold', parseInt(e.target.value) / 100)}
                                    disabled={!safeSettings.enabled}
                                    className="w-full h-2 bg-surface rounded-lg appearance-none cursor-pointer accent-primary"
                                />
                                <p className="text-xs text-textSecondary/70">
                                    Summarize when context usage reaches this threshold
                                </p>
                            </div>
                        )}

                        <div className="pt-3 border-t border-white/5 space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-sm text-textPrimary">Meeting Briefing Lead Time</label>
                                <span className="text-xs font-mono bg-surface px-2 py-0.5 rounded text-primary">
                                    {safeSettings.contextAwareness.meetingBriefingLeadTimeMinutes} min
                                </span>
                            </div>
                            <input
                                type="range"
                                min="1"
                                max="30"
                                step="1"
                                value={safeSettings.contextAwareness.meetingBriefingLeadTimeMinutes}
                                onChange={(e) => handleNestedChange('contextAwareness', 'meetingBriefingLeadTimeMinutes', parseInt(e.target.value))}
                                disabled={!safeSettings.enabled}
                                className="w-full h-2 bg-surface rounded-lg appearance-none cursor-pointer accent-primary"
                            />
                            <p className="text-xs text-textSecondary/70">
                                How many minutes before a calendar event to inject a briefing
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Quiet Hours */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium text-textSecondary uppercase tracking-wider flex items-center gap-2">
                        <span>🕒</span> Quiet Hours
                    </h4>
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-textSecondary">Enabled</span>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={safeSettings.quietHours.enabled}
                                onChange={(e) => handleNestedChange('quietHours', 'enabled', e.target.checked)}
                                disabled={!safeSettings.enabled}
                                className="sr-only peer"
                            />
                            <div className="w-9 h-5 bg-surface rounded-full peer peer-focus:ring-2 peer-focus:ring-primary/30 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                        </label>
                    </div>
                </div>

                {safeSettings.quietHours.enabled && (
                    <div className="bg-surface/20 rounded-xl p-4 border border-white/5 flex gap-4 items-center">
                        <div className="flex-1">
                            <label className="text-xs text-textSecondary block mb-1">Start Time</label>
                            <input
                                type="number"
                                min="0" max="23"
                                value={safeSettings.quietHours.start}
                                onChange={(e) => handleNestedChange('quietHours', 'start', parseInt(e.target.value))}
                                className="w-full bg-input border border-white/10 rounded px-3 py-2 text-textPrimary"
                            />
                        </div>
                        <div className="flex-1">
                            <label className="text-xs text-textSecondary block mb-1">End Time</label>
                            <input
                                type="number"
                                min="0" max="23"
                                value={safeSettings.quietHours.end}
                                onChange={(e) => handleNestedChange('quietHours', 'end', parseInt(e.target.value))}
                                className="w-full bg-input border border-white/10 rounded px-3 py-2 text-textPrimary"
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Notifications */}
            <div className="space-y-4">
                <h4 className="text-sm font-medium text-textSecondary uppercase tracking-wider flex items-center gap-2">
                    <span>🔔</span> Notifications
                </h4>
                <div className="bg-surface/20 rounded-xl p-4 space-y-3 border border-white/5">
                    <CheckboxRow
                        label="Sound"
                        checked={safeSettings.notifications.sound}
                        onChange={(v: boolean) => handleNestedChange('notifications', 'sound', v)}
                        disabled={!safeSettings.enabled}
                    />
                    <CheckboxRow
                        label="Vibration"
                        checked={safeSettings.notifications.vibration}
                        onChange={(v: boolean) => handleNestedChange('notifications', 'vibration', v)}
                        disabled={!safeSettings.enabled}
                    />
                    <CheckboxRow
                        label="LED Indicator"
                        checked={safeSettings.notifications.led}
                        onChange={(v: boolean) => handleNestedChange('notifications', 'led', v)}
                        disabled={!safeSettings.enabled}
                    />
                    <CheckboxRow
                        label="Group Notifications"
                        checked={safeSettings.notifications.grouping}
                        onChange={(v: boolean) => handleNestedChange('notifications', 'grouping', v)}
                        disabled={!safeSettings.enabled}
                    />
                    <div className="pt-2">
                        <label className="text-xs text-textSecondary block mb-1">Priority Level</label>
                        <select
                            value={safeSettings.notifications.priority}
                            onChange={(e) => handleNestedChange('notifications', 'priority', e.target.value)}
                            disabled={!safeSettings.enabled}
                            className="w-full bg-input border border-white/10 rounded px-3 py-2 text-sm text-textPrimary outline-none focus:border-primary"
                        >
                            <option value="min">Minimum</option>
                            <option value="low">Low</option>
                            <option value="default">Default</option>
                            <option value="high">High</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Learning & Adaptation */}
            <div className="space-y-4">
                <h4 className="text-sm font-medium text-textSecondary uppercase tracking-wider flex items-center gap-2">
                    <span>🧠</span> Learning & Adaptation
                </h4>
                <div className="bg-surface/20 rounded-xl p-4 space-y-3 border border-white/5">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-textPrimary font-medium">Enable Learning</span>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={safeSettings.learning.enabled}
                                onChange={(e) => handleNestedChange('learning', 'enabled', e.target.checked)}
                                disabled={!safeSettings.enabled}
                                className="sr-only peer"
                            />
                            <div className="w-9 h-5 bg-surface rounded-full peer peer-focus:ring-2 peer-focus:ring-primary/30 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                        </label>
                    </div>

                    <CheckboxRow
                        label="Track Dismissals"
                        desc="Learn when you dismiss suggestions to show them less often"
                        checked={safeSettings.learning.trackDismissals}
                        onChange={(v: boolean) => handleNestedChange('learning', 'trackDismissals', v)}
                        disabled={!safeSettings.enabled || !safeSettings.learning.enabled}
                    />
                    <CheckboxRow
                        label="Track Interactions"
                        desc="Learn which features you use most to prioritize them"
                        checked={safeSettings.learning.trackInteractions}
                        onChange={(v: boolean) => handleNestedChange('learning', 'trackInteractions', v)}
                        disabled={!safeSettings.enabled || !safeSettings.learning.enabled}
                    />
                    <CheckboxRow
                        label="Adapt Frequency"
                        desc="Automatically reduce notification frequency if you are busy"
                        checked={safeSettings.learning.adaptFrequency}
                        onChange={(v: boolean) => handleNestedChange('learning', 'adaptFrequency', v)}
                        disabled={!safeSettings.enabled || !safeSettings.learning.enabled}
                    />
                </div>
            </div>

            {/* Limits */}
            <div className="space-y-4">
                <h4 className="text-sm font-medium text-textSecondary uppercase tracking-wider flex items-center gap-2">
                    <span>🛑</span> Constraints & Limits
                </h4>
                <div className="bg-surface/20 rounded-xl p-4 space-y-4 border border-white/5">
                    <div>
                        <div className="flex items-center justify-between">
                            <label className="text-sm text-textPrimary">Max Actions Per Hour</label>
                            <span className="text-xs font-mono bg-surface px-2 py-0.5 rounded text-primary">
                                {safeSettings.limits.maxActionsPerHour}
                            </span>
                        </div>
                        <input
                            type="range"
                            min="1" max="20" step="1"
                            value={safeSettings.limits.maxActionsPerHour}
                            onChange={(e) => handleNestedChange('limits', 'maxActionsPerHour', parseInt(e.target.value))}
                            disabled={!safeSettings.enabled}
                            className="w-full h-2 mt-2 bg-surface rounded-lg appearance-none cursor-pointer accent-primary"
                        />
                    </div>
                    <div>
                        <div className="flex items-center justify-between">
                            <label className="text-sm text-textPrimary">Max Autonomous Actions Per Day</label>
                            <span className="text-xs font-mono bg-surface px-2 py-0.5 rounded text-primary">
                                {safeSettings.limits.maxAutonomousPerDay}
                            </span>
                        </div>
                        <input
                            type="range"
                            min="0" max="50" step="1"
                            value={safeSettings.limits.maxAutonomousPerDay}
                            onChange={(e) => handleNestedChange('limits', 'maxAutonomousPerDay', parseInt(e.target.value))}
                            disabled={!safeSettings.enabled}
                            className="w-full h-2 mt-2 bg-surface rounded-lg appearance-none cursor-pointer accent-primary"
                        />
                    </div>
                    <div>
                        <div className="flex items-center justify-between">
                            <label className="text-sm text-textPrimary">Max Chat Messages Per Day</label>
                            <span className="text-xs font-mono bg-surface px-2 py-0.5 rounded text-primary">
                                {safeSettings.limits.maxChatMessagesPerDay}
                            </span>
                        </div>
                        <input
                            type="range"
                            min="0" max="50" step="5"
                            value={safeSettings.limits.maxChatMessagesPerDay}
                            onChange={(e) => handleNestedChange('limits', 'maxChatMessagesPerDay', parseInt(e.target.value))}
                            disabled={!safeSettings.enabled}
                            className="w-full h-2 mt-2 bg-surface rounded-lg appearance-none cursor-pointer accent-primary"
                        />
                    </div>
                </div>
            </div>

        </div>
    );
};

const PermissionToggle = ({ label, desc, checked, onChange, disabled, warning }: any) => (
    <div className={`p-3 rounded-lg border flex items-start gap-3 transition-colors ${checked ? 'bg-primary/5 border-primary/20' : 'bg-surface/30 border-transparent'} ${disabled ? 'opacity-50' : ''}`}>
        <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            disabled={disabled}
            className="mt-1 w-4 h-4 rounded border-gray-600 text-primary focus:ring-primary/50 bg-surface/50"
        />
        <div>
            <div className={`font-medium text-sm ${warning && checked ? 'text-yellow-400' : 'text-textPrimary'}`}>{label}</div>
            <div className="text-xs text-textSecondary">{desc}</div>
        </div>
    </div>
);

const CheckboxRow = ({ label, desc, checked, onChange, disabled }: any) => (
    <label className={`flex items-start gap-3 cursor-pointer ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
        <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            disabled={disabled}
            className="mt-1 w-4 h-4 rounded border-gray-600 text-primary focus:ring-primary/50 bg-surface/50"
        />
        <div className="flex-1">
            <div className="text-sm text-textPrimary">{label}</div>
            {desc && <div className="text-xs text-textSecondary mt-0.5">{desc}</div>}
        </div>
    </label>
);

export default ProactiveSettings;
