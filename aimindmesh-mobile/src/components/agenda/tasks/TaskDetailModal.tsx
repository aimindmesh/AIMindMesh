/**
 * Task Detail Modal Component
 * Create and edit tasks with full form fields
 */

import React, { useState, useEffect } from 'react';
import { CalendarTask, TaskStatus, TaskPriority } from '../../../types/calendar';
import * as TaskDB from '../../../services/calendar/taskDatabase';
import { logger } from '../../../services/logger';
import { AiTaskService } from '../../../services/calendar/AiTaskService';
import TaskAiPanel from './TaskAiPanel';

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

    useEffect(() => {
        if (task) {
            setFormData(task);
            setTagsInput(task.tags.join(', '));
        }
    }, [task]);

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
                // Update existing task (its reminder follows inside updateTask)
                await TaskDB.updateTask(task.id, {
                    ...formData,
                    tags
                });

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

                // Sync to server if AI task (createTask scheduled the reminder of a user task)
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
                // Also cancels its reminder and removes an AI task from the server
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
                            onChange={(e) => e.target.value && setFormData({
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

                    <TaskAiPanel task={task} formData={formData} setFormData={setFormData} />

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
