/**
 * Task Detail Modal Component
 * Create and edit tasks with full form fields
 */

import React, { useState, useEffect } from 'react';
import { CalendarTask, TaskStatus, TaskPriority } from '../../../types/calendar';
import * as TaskDB from '../../../services/calendar/taskDatabase';
import { scheduleTaskNotification, cancelTaskNotification } from '../../../services/calendar/taskNotifications';
import { logger } from '../../../services/logger';
import { CRON_PRESETS, AiModel, AiStoragePolicy } from '../../../types/calendar';
import { AiTaskService } from '../../../services/calendar/AiTaskService';
import { useLocalStorage } from '../../../hooks/useLocalStorage';
import { AIMindMeshServerSettings, DEFAULT_AIMINDMESH_SERVER_SETTINGS } from '../../../types';

interface TaskDetailModalProps {
    task: CalendarTask | null; // null = create new
    onClose: () => void;
}

const TaskDetailModal: React.FC<TaskDetailModalProps> = ({ task, onClose }) => {
    const [formData, setFormData] = useState<Partial<CalendarTask>>({
        title: '',
        description: '',
        status: 'todo',
        priority: 'medium',
        dueDate: Date.now() + 24 * 60 * 60 * 1000, // Tomorrow
        tags: [],
        estimatedHours: undefined,
        pomodoroTarget: undefined,
        recurrenceRule: undefined,
        color: '#3b82f6',
        assignee: 'user',
        aiConfig: undefined
    });
    const [tagsInput, setTagsInput] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // AI Execution UI State
    const [isActionRunning, setIsActionRunning] = useState(false);
    const [artifactData, setArtifactData] = useState<string | null>(null);
    const [aimindmeshServer] = useLocalStorage<AIMindMeshServerSettings>('aimindmesh-server-settings', DEFAULT_AIMINDMESH_SERVER_SETTINGS);

    useEffect(() => {
        if (task) {
            setFormData(task);
            setTagsInput(task.tags.join(', '));
        }
    }, [task]);

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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (!formData.title?.trim()) {
            setError('Title is required');
            return;
        }

        setIsSubmitting(true);

        try {
            // Parse tags from input
            const tags = tagsInput
                .split(',')
                .map(t => t.trim())
                .filter(Boolean);

            if (task) {
                // Update existing task
                await TaskDB.updateTask(task.id, {
                    ...formData,
                    tags
                });

                // Reschedule notification if due date changed
                if (formData.dueDate && formData.dueDate !== task.dueDate) {
                    const updatedTask = await TaskDB.getTaskById(task.id);
                    if (updatedTask) {
                        await scheduleTaskNotification(updatedTask);
                    }
                }

                // Sync to server if AI task
                if (formData.assignee === 'ai') {
                    try {
                        const updatedTask = await TaskDB.getTaskById(task.id);
                        if (updatedTask) {
                            await AiTaskService.syncTask(updatedTask);
                        }
                    } catch (e) {
                        logger.log('warn', '[TaskModal] AI task sync error on update', e);
                    }
                }

                logger.log('info', `[TaskModal] Task updated: ${task.id}`);
            } else {
                // Create new task
                const newTask = await TaskDB.createTask({
                    title: formData.title!,
                    description: formData.description || '',
                    status: (formData.status as TaskStatus) || 'todo',
                    priority: (formData.priority as TaskPriority) || 'medium',
                    dueDate: formData.dueDate || Date.now(),
                    tags,
                    estimatedHours: formData.estimatedHours,
                    pomodoroTarget: formData.pomodoroTarget,
                    recurrenceRule: formData.recurrenceRule,
                    color: formData.color,
                    assignee: formData.assignee,
                    aiConfig: formData.aiConfig
                });

                // Schedule notification if user task
                if (newTask.assignee !== 'ai') {
                    await scheduleTaskNotification(newTask);
                }

                // Sync to server if AI task
                if (newTask.assignee === 'ai') {
                    try {
                        await AiTaskService.syncTask(newTask);
                    } catch (e) {
                         logger.log('warn', '[TaskModal] AI task sync error', e);
                         // Don't block closing if network fails, there will be a retry mechanism
                    }
                }

                logger.log('info', `[TaskModal] Task created: ${newTask.id}`);
            }

            onClose();
        } catch (err) {
            logger.log('error', '[TaskModal] Failed to save task', err);
            setError('Error saving task');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async () => {
        if (!task) return;

        if (confirm('Are you sure you want to delete this task?')) {
            try {
                await cancelTaskNotification(task.id);
                await TaskDB.deleteTask(task.id);
                logger.log('info', `[TaskModal] Task deleted: ${task.id}`);
                onClose();
            } catch (err) {
                logger.log('error', '[TaskModal] Failed to delete task', err);
                setError('Error deleting task');
            }
        }
    };

    // Format date for datetime-local input
    const formatDateForInput = (timestamp: number): string => {
        const date = new Date(timestamp);
        const offset = date.getTimezoneOffset();
        const localDate = new Date(date.getTime() - offset * 60 * 1000);
        return localDate.toISOString().slice(0, 16);
    };

    // AI Helper methods
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

    return (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-surface rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-white/10">
                    <h2 className="text-xl font-bold text-white">
                        {task ? 'Edit Task' : 'New Task'}
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-white/10 rounded-full transition-colors"
                    >
                        <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-4 space-y-4">
                    {/* Error message */}
                    {error && (
                        <div className="p-3 bg-red-900/50 border border-red-500 rounded-lg text-red-300 text-sm">
                            {error}
                        </div>
                    )}

                    {/* Title */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                            Title *
                        </label>
                        <input
                            type="text"
                            value={formData.title}
                            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                            className="w-full px-3 py-2 bg-input border border-white/10 rounded-lg 
                                text-white placeholder-gray-500 focus:ring-2 focus:ring-primary focus:border-transparent"
                            placeholder="Enter task title..."
                            required
                        />
                    </div>

                    {/* Description */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                            Description
                        </label>
                        <textarea
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            className="w-full px-3 py-2 bg-input border border-white/10 rounded-lg 
                                text-white placeholder-gray-500 focus:ring-2 focus:ring-primary focus:border-transparent"
                            placeholder="Add details..."
                            rows={3}
                        />
                    </div>

                    {/* Priority & Status Row */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1 flex items-center gap-1">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                        d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
                                </svg>
                                Priority
                            </label>
                            <select
                                value={formData.priority}
                                onChange={(e) => setFormData({ ...formData, priority: e.target.value as TaskPriority })}
                                className="w-full px-3 py-2 bg-input border border-white/10 rounded-lg 
                                    text-white focus:ring-2 focus:ring-primary focus:border-transparent"
                            >
                                <option value="low">Low</option>
                                <option value="medium">Medium</option>
                                <option value="high">High</option>
                                <option value="urgent">Urgent</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">
                                Status
                            </label>
                            <select
                                value={formData.status}
                                onChange={(e) => setFormData({ ...formData, status: e.target.value as TaskStatus })}
                                className="w-full px-3 py-2 bg-input border border-white/10 rounded-lg 
                                    text-white focus:ring-2 focus:ring-primary focus:border-transparent"
                            >
                                <option value="backlog">Backlog</option>
                                <option value="todo">To Do</option>
                                <option value="in-progress">In Progress</option>
                                <option value="review">Review</option>
                                <option value="done">Done</option>
                            </select>
                        </div>
                    </div>

                    {/* Due Date */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1 flex items-center gap-1">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            Due Date
                        </label>
                        <input
                            type="datetime-local"
                            value={formatDateForInput(formData.dueDate || Date.now())}
                            onChange={(e) => setFormData({
                                ...formData,
                                dueDate: new Date(e.target.value).getTime()
                            })}
                            className="w-full px-3 py-2 bg-input border border-white/10 rounded-lg 
                                text-white focus:ring-2 focus:ring-primary focus:border-transparent"
                        />
                    </div>

                    {/* Tags */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1 flex items-center gap-1">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                            </svg>
                            Tags
                        </label>
                        <input
                            type="text"
                            value={tagsInput}
                            onChange={(e) => setTagsInput(e.target.value)}
                            className="w-full px-3 py-2 bg-input border border-white/10 rounded-lg 
                                text-white placeholder-gray-500 focus:ring-2 focus:ring-primary focus:border-transparent"
                            placeholder="work, personal, urgent (comma separated)"
                        />
                    </div>

                    {/* Time Estimation & Pomodoro */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1 flex items-center gap-1">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                Estimated Hours
                            </label>
                            <input
                                type="number"
                                step="0.5"
                                min="0"
                                value={formData.estimatedHours || ''}
                                onChange={(e) => setFormData({
                                    ...formData,
                                    estimatedHours: e.target.value ? parseFloat(e.target.value) : undefined
                                })}
                                className="w-full px-3 py-2 bg-input border border-white/10 rounded-lg 
                                    text-white placeholder-gray-500 focus:ring-2 focus:ring-primary focus:border-transparent"
                                placeholder="2.5"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">
                                🍅 Pomodoro Target
                            </label>
                            <input
                                type="number"
                                min="0"
                                value={formData.pomodoroTarget || ''}
                                onChange={(e) => setFormData({
                                    ...formData,
                                    pomodoroTarget: e.target.value ? parseInt(e.target.value) : undefined
                                })}
                                className="w-full px-3 py-2 bg-input border border-white/10 rounded-lg 
                                    text-white placeholder-gray-500 focus:ring-2 focus:ring-primary focus:border-transparent"
                                placeholder="4"
                            />
                        </div>
                    </div>

                    {/* Recurrence */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1 flex items-center gap-1">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            Recurrence
                        </label>
                        <select
                            value={formData.recurrenceRule?.type || 'none'}
                            onChange={(e) => {
                                if (e.target.value === 'none') {
                                    setFormData({ ...formData, recurrenceRule: undefined });
                                } else {
                                    setFormData({
                                        ...formData,
                                        recurrenceRule: {
                                            type: e.target.value as 'daily' | 'weekly' | 'monthly',
                                            interval: 1,
                                            endDate: null
                                        }
                                    });
                                }
                            }}
                            className="w-full px-3 py-2 bg-input border border-white/10 rounded-lg 
                                text-white focus:ring-2 focus:ring-primary focus:border-transparent"
                        >
                            <option value="none">No repetition</option>
                            <option value="daily">Daily</option>
                            <option value="weekly">Weekly</option>
                            <option value="monthly">Monthly</option>
                        </select>
                    </div>

                    {/* Color picker */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                            Color
                        </label>
                        <div className="flex gap-2">
                            {['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'].map(color => (
                                <button
                                    key={color}
                                    type="button"
                                    onClick={() => setFormData({ ...formData, color })}
                                    className={`w-8 h-8 rounded-full border-2 transition-all ${formData.color === color
                                        ? 'border-white scale-110'
                                        : 'border-transparent hover:scale-105'
                                        }`}
                                    style={{ backgroundColor: color }}
                                />
                            ))}
                        </div>
                    </div>

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
                                        onChange={(e) => setFormData({ ...formData, aiConfig: { ...formData.aiConfig!, model: e.target.value as AiModel } })}
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
                                        onChange={(e) => setFormData({ ...formData, aiConfig: { ...formData.aiConfig!, promptTemplate: e.target.value } })}
                                        className="w-full px-2 py-1 bg-surface border border-white/10 rounded text-sm
                                            text-white focus:ring-1 focus:ring-indigo-500"
                                        rows={3}
                                    />
                                    <p className="text-xs text-gray-500 mt-1">You can use &#123;&#123;task.title&#125;&#125; etc. The server will inject the data.</p>
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="block text-xs font-medium text-gray-400 mb-1">Schedule (Cron)</label>
                                        <select
                                            value={formData.aiConfig.cronExpression || 'none'}
                                            onChange={(e) => setFormData({ ...formData, aiConfig: { ...formData.aiConfig!, cronExpression: e.target.value === 'none' ? undefined : e.target.value } })}
                                            className="w-full px-2 py-1 bg-surface border border-white/10 rounded text-sm
                                                text-white focus:ring-1 focus:ring-indigo-500"
                                        >
                                            <option value="none">One Shot / Manual Trigger</option>
                                            {CRON_PRESETS.map(preset => (
                                                <option key={preset.value} value={preset.value}>{preset.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    
                                    <div>
                                        <label className="block text-xs font-medium text-gray-400 mb-1">Storage Policy</label>
                                        <select
                                            value={formData.aiConfig.storagePolicy}
                                            onChange={(e) => setFormData({ ...formData, aiConfig: { ...formData.aiConfig!, storagePolicy: e.target.value as AiStoragePolicy } })}
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


                    {/* Action Buttons */}
                    <div className="flex items-center justify-between pt-4 border-t border-white/10">
                        {task ? (
                            <button
                                type="button"
                                onClick={handleDelete}
                                className="px-4 py-2 bg-red-900/50 text-red-300 rounded-lg 
                                    hover:bg-red-900/70 transition flex items-center gap-2"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                                Delete
                            </button>
                        ) : (
                            <div />
                        )}

                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-4 py-2 bg-white/10 text-gray-300 rounded-lg hover:bg-white/20 transition"
                            >
                                Cancel
                            </button>

                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="px-4 py-2 bg-primary text-white rounded-lg 
                                    hover:bg-primary-dark transition disabled:opacity-50"
                            >
                                {isSubmitting ? 'Saving...' : task ? 'Update' : 'Create'}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default TaskDetailModal;
