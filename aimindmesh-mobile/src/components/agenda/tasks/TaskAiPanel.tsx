/**
 * AI Delegation panel of the task modal: assignment toggle, server task settings,
 * execution status polling and output viewer.
 */

import React, { useState, useEffect } from 'react';
import { CalendarTask, CRON_PRESETS, AiModel, AiStoragePolicy } from '../../../types/calendar';
import { AiTaskService } from '../../../services/calendar/AiTaskService';
import { useLocalStorage } from '../../../hooks/useLocalStorage';
import { AIMindMeshServerSettings, DEFAULT_AIMINDMESH_SERVER_SETTINGS } from '../../../types';
import { logger } from '../../../services/logger';

interface TaskAiPanelProps {
    task: CalendarTask | null;
    formData: Partial<CalendarTask>;
    setFormData: React.Dispatch<React.SetStateAction<Partial<CalendarTask>>>;
}

const PRESET_CRONS = CRON_PRESETS.map(p => p.value).filter(v => v !== 'custom');

/** Five (or six, with seconds) cron fields: what node-cron accepts on the server */
export const isValidCronShape = (expr: string) => /^\S+(\s+\S+){4,5}$/.test(expr.trim());

/** Preset picker plus a free field for "Personalizzato…" (the literal 'custom' is never sent) */
const CronPicker: React.FC<{ value?: string; onChange: (cron: string | undefined) => void }> = ({ value, onChange }) => {
    const [isCustom, setIsCustom] = useState(!!value && !PRESET_CRONS.includes(value));
    const inputClass = 'w-full px-2 py-1 bg-surface border border-white/10 rounded text-sm text-white focus:ring-1 focus:ring-indigo-500';

    return (
        <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Schedule (Cron)</label>
            <select
                value={isCustom ? 'custom' : (value || 'none')}
                onChange={(e) => {
                    const selected = e.target.value;
                    setIsCustom(selected === 'custom');
                    if (selected !== 'custom') onChange(selected === 'none' ? undefined : selected);
                    else if (value && PRESET_CRONS.includes(value)) onChange(undefined);
                }}
                className={inputClass}
            >
                <option value="none">One Shot / Manual Trigger</option>
                {CRON_PRESETS.map(preset => (
                    <option key={preset.value} value={preset.value}>{preset.label}</option>
                ))}
            </select>
            {isCustom && (
                <>
                    <input
                        type="text"
                        value={value || ''}
                        onChange={(e) => onChange(e.target.value.trim() ? e.target.value : undefined)}
                        placeholder="m h dom mon dow (e.g. 30 6 * * 1-5)"
                        className={`${inputClass} mt-1 font-mono`}
                    />
                    {value && !isValidCronShape(value) && (
                        <p className="text-xs text-red-400 mt-1">Needs 5 fields: minute hour day month weekday</p>
                    )}
                </>
            )}
        </div>
    );
};

const TaskAiPanel: React.FC<TaskAiPanelProps> = ({ task, formData, setFormData }) => {
    // AI Execution UI State
    const [isActionRunning, setIsActionRunning] = useState(false);
    const [artifactData, setArtifactData] = useState<string | null>(null);
    const [aimindmeshServer] = useLocalStorage<AIMindMeshServerSettings>('aimindmesh-server-settings', DEFAULT_AIMINDMESH_SERVER_SETTINGS);

    // Execution Status Polling
    useEffect(() => {
        if (!task?.id || task.assignee !== 'ai' || !aimindmeshServer.enabled) return;

        // Poll interval from configuration (default 15s)
        const intervalMs = (aimindmeshServer.aiTaskPollingInterval || 15) * 1000;

        const pollStatus = async () => {
            try {
                const lastExec = await AiTaskService.getLastExecution(task.id);
                if (lastExec) {
                    setFormData(prev => ({
                        ...prev,
                        aiConfig: {
                            ...prev.aiConfig!,
                            lastExecution: lastExec
                        }
                    }));
                }
            } catch (e) {
                logger.log('warn', '[TaskModal] Polling execution status failed', e);
            }
        };

        // First immediate check if task is in active/review state
        pollStatus();

        const timer = setInterval(pollStatus, intervalMs);
        return () => clearInterval(timer);
    }, [task?.id, task?.assignee, aimindmeshServer.enabled, aimindmeshServer.aiTaskPollingInterval]);

    const toggleAiAssignment = () => {
        const isCurrentlyAi = formData.assignee === 'ai';
        if (isCurrentlyAi) {
            setFormData({ ...formData, assignee: 'user', aiConfig: undefined });
        } else {
            setFormData({
                ...formData,
                assignee: 'ai',
                aiConfig: {
                    model: 'auto',
                    promptTemplate: formData.description || 'Execute the task',
                    outputFormat: 'markdown',
                    storagePolicy: 'server_disk',
                    requiresReview: false,
                    cronExpression: undefined // one-shot by default
                }
            });
        }
    };

    const handleRunNow = async () => {
        if (!task?.id) return;
        setIsActionRunning(true);
        try {
            await AiTaskService.runNow(task.id);
            alert('Task sent for immediate execution!');
        } catch (e: any) {
            alert('RunNow Error: ' + e.message);
        } finally {
            setIsActionRunning(false);
        }
    };

    const handleViewArtifact = async () => {
        if (!task?.id) return;
        setIsActionRunning(true);
        try {
            const data = await AiTaskService.getArtifact(task.id);
            setArtifactData(data);
        } catch (e: any) {
            alert('getArtifact Error: ' + e.message);
        } finally {
            setIsActionRunning(false);
        }
    };

    const updateAiConfig = (changes: Partial<NonNullable<CalendarTask['aiConfig']>>) =>
        setFormData({ ...formData, aiConfig: { ...formData.aiConfig!, ...changes } });

    return (
        <>
            {/* AI Delegation Panel */}
            <div className="pt-4 border-t border-white/10">
                <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-white flex items-center gap-2">
                        🤖 AI Delegation
                    </label>
                    <button
                        type="button"
                        onClick={toggleAiAssignment}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${formData.assignee === 'ai' ? 'bg-indigo-500' : 'bg-gray-700'}`}
                    >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.assignee === 'ai' ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                </div>

                {formData.assignee === 'ai' && formData.aiConfig && (
                    <div className="bg-black/20 p-3 rounded-lg border border-indigo-500/30 space-y-3 mt-2">

                        <div>
                            <label className="block text-xs font-medium text-gray-400 mb-1">Model / Service</label>
                            <select
                                value={formData.aiConfig.model}
                                onChange={(e) => updateAiConfig({ model: e.target.value as AiModel })}
                                className="w-full px-2 py-1 bg-surface border border-white/10 rounded
                                    text-sm text-white focus:ring-1 focus:ring-indigo-500"
                            >
                                <option value="auto">Auto (Best Available)</option>
                                <option value="ollama">Ollama (Local/Network)</option>
                                <option value="gemini">Gemini (Cloud via Server)</option>
                                <option value="openclaw">OpenClaw Ecosystem (Agentic)</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-xs font-medium text-gray-400 mb-1">Prompt Template</label>
                            <textarea
                                value={formData.aiConfig.promptTemplate}
                                onChange={(e) => updateAiConfig({ promptTemplate: e.target.value })}
                                className="w-full px-2 py-1 bg-surface border border-white/10 rounded text-sm
                                    text-white focus:ring-1 focus:ring-indigo-500"
                                rows={3}
                            />
                            <p className="text-xs text-gray-500 mt-1">You can use &#123;&#123;task.title&#125;&#125; etc. The server will inject the data.</p>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <CronPicker
                                value={formData.aiConfig.cronExpression}
                                onChange={(cronExpression) => updateAiConfig({ cronExpression })}
                            />

                            <div>
                                <label className="block text-xs font-medium text-gray-400 mb-1">Storage Policy</label>
                                <select
                                    value={formData.aiConfig.storagePolicy}
                                    onChange={(e) => updateAiConfig({ storagePolicy: e.target.value as AiStoragePolicy })}
                                    className="w-full px-2 py-1 bg-surface border border-white/10 rounded text-sm
                                        text-white focus:ring-1 focus:ring-indigo-500"
                                >
                                    <option value="server_disk">Only Server Disk</option>
                                    <option value="server_disk_gitea">Disk + Gitea Commit</option>
                                </select>
                            </div>
                        </div>

                        {/* Server Last Execution Info */}
                        {task?.aiConfig?.lastExecution && (
                            <div className="bg-white/5 p-2 rounded text-xs text-gray-300 flex flex-col gap-1">
                                <div className="flex justify-between items-center">
                                    <span><strong>State:</strong> {task.aiConfig.lastExecution.status}</span>
                                    {task.aiConfig.lastExecution.updatedAt && (
                                        <span className="opacity-60">{new Date(task.aiConfig.lastExecution.updatedAt).toLocaleString()}</span>
                                    )}
                                </div>
                                {task.aiConfig.lastExecution.errorMessage && (
                                    <span className="text-red-400">Error: {task.aiConfig.lastExecution.errorMessage}</span>
                                )}
                                {task.aiConfig.lastExecution.artifactPath && (
                                    <div className="flex gap-2 mt-2">
                                        <button
                                            type="button"
                                            onClick={handleViewArtifact}
                                            disabled={isActionRunning}
                                            className="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 rounded text-white flex-1 transition"
                                        >
                                            {isActionRunning ? '...' : 'View Output'}
                                        </button>
                                        {task.aiConfig.lastExecution.status === 'needs_review' && (
                                            <button type="button" className="px-2 py-1 bg-green-600 hover:bg-green-500 rounded text-white transition">Approve</button>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Action bar for existing tasks */}
                        {task?.id && (
                            <div className="flex justify-end pt-2">
                                <button
                                    type="button"
                                    onClick={handleRunNow}
                                    disabled={isActionRunning}
                                    className="px-3 py-1 bg-white/10 hover:bg-indigo-500/50 rounded text-sm transition flex items-center gap-1"
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    Force Run Now
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Output Modal (Overlay) */}
            {artifactData && (
                <div className="fixed inset-0 z-[60] bg-black/90 flex flex-col p-4">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-white font-bold text-lg">AI Task Output</h3>
                        <button type="button" onClick={() => setArtifactData(null)} className="p-2 bg-white/10 rounded-full hover:bg-red-500">
                            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </div>
                    <div className="flex-1 bg-surface p-4 rounded overflow-auto outline-none border border-white/10 text-gray-300 font-mono text-sm whitespace-pre-wrap">
                        {artifactData}
                    </div>
                </div>
            )}
        </>
    );
};

export default TaskAiPanel;
