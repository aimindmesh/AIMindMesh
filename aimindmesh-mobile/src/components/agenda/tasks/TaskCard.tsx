/**
 * Task Card Component
 * Individual task card for Kanban board with priority, due date, and progress
 */

import React from 'react';
import { CalendarTask, TaskPriority } from '../../../types/calendar';

interface TaskCardProps {
    task: CalendarTask;
    compact?: boolean;
}

// Priority configuration
const PRIORITY_CONFIG: Record<TaskPriority, { colorClass: string; bgClass: string; label: string }> = {
    low: { colorClass: 'text-gray-400', bgClass: 'bg-gray-700/50', label: 'Low' },
    medium: { colorClass: 'text-blue-400', bgClass: 'bg-blue-900/50', label: 'Medium' },
    high: { colorClass: 'text-orange-400', bgClass: 'bg-orange-900/50', label: 'High' },
    urgent: { colorClass: 'text-red-400', bgClass: 'bg-red-900/50', label: 'Urgent' }
};

const TaskCard: React.FC<TaskCardProps> = ({ task, compact = false }) => {
    const dueDate = new Date(task.dueDate);
    const now = new Date();
    const isOverdue = dueDate < now && task.status !== 'done';
    const isToday = dueDate.toDateString() === now.toDateString();
    const isDueSoon = dueDate < new Date(now.getTime() + 24 * 60 * 60 * 1000) && !isToday;

    const priority = PRIORITY_CONFIG[task.priority];

    // Format due date
    const formatDueDate = () => {
        const options: Intl.DateTimeFormatOptions = {
            month: 'short',
            day: 'numeric'
        };
        if (dueDate.getFullYear() !== now.getFullYear()) {
            options.year = 'numeric';
        }
        return dueDate.toLocaleDateString('en-US', options);
    };

    // Get due date color class
    const getDueDateColorClass = () => {
        if (isOverdue) return 'text-red-400';
        if (isToday) return 'text-blue-400';
        if (isDueSoon) return 'text-orange-400';
        return 'text-gray-400';
    };

    return (
        <div
            className="bg-surface rounded-lg p-3 border border-white/10 hover:border-primary/50 transition-colors"
            style={{
                borderLeftWidth: '4px',
                borderLeftColor: task.color || '#3b82f6'
            }}
        >
            {/* Priority Badge */}
            <div className="flex items-center justify-between mb-2">
                <div className="flex gap-2">
                    <span className={`text-xs font-semibold px-2 py-1 rounded ${priority.bgClass} ${priority.colorClass}`}>
                        {priority.label}
                    </span>
                    {task.assignee === 'ai' && (
                        <span className="text-xs font-semibold px-2 py-1 rounded bg-indigo-900/50 text-indigo-300 flex items-center gap-1">
                            🤖 AI
                            {task.aiConfig?.lastExecution?.status && (
                                <span className="opacity-75">
                                    • {task.aiConfig.lastExecution.status}
                                </span>
                            )}
                        </span>
                    )}
                </div>

                {task.estimatedHours && (
                    <span className="text-xs text-gray-500 flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {task.estimatedHours}h
                    </span>
                )}
            </div>

            {/* Title */}
            <h4 className="font-medium text-sm text-white mb-2 line-clamp-2">
                {task.title}
            </h4>

            {/* Description */}
            {task.description && !compact && (
                <p className="text-xs text-gray-400 line-clamp-2 mb-2">
                    {task.description}
                </p>
            )}

            {/* AI Summary */}
            {task.assignee === 'ai' && task.aiConfig?.lastExecution?.outputSummary && !compact && (
                <div className="bg-black/20 rounded p-2 mb-2">
                    <p className="text-xs text-gray-300 line-clamp-2 border-l-2 border-indigo-500 pl-2">
                        {task.aiConfig.lastExecution.outputSummary}
                    </p>
                </div>
            )}

            {/* Tags */}
            {task.tags.length > 0 && !compact && (
                <div className="flex flex-wrap gap-1 mb-2">
                    {task.tags.slice(0, 3).map(tag => (
                        <span
                            key={tag}
                            className="text-xs bg-white/10 text-gray-300 px-2 py-0.5 rounded"
                        >
                            #{tag}
                        </span>
                    ))}
                    {task.tags.length > 3 && (
                        <span className="text-xs text-gray-500">
                            +{task.tags.length - 3}
                        </span>
                    )}
                </div>
            )}

            {/* Due Date */}
            <div className={`text-xs flex items-center gap-1 font-medium ${getDueDateColorClass()}`}>
                {isOverdue ? (
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                ) : (
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                )}

                {formatDueDate()}

                {isOverdue && <span>(Overdue)</span>}
                {isToday && <span>(Today)</span>}
            </div>

            {/* Pomodoro Progress */}
            {task.pomodoroTarget && task.pomodoroTarget > 0 && (
                <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs">🍅</span>
                    <div className="flex-1 bg-gray-700 rounded-full h-1.5">
                        <div
                            className="bg-red-500 h-1.5 rounded-full transition-all"
                            style={{
                                width: `${Math.min((task.pomodoroCount / task.pomodoroTarget) * 100, 100)}%`
                            }}
                        />
                    </div>
                    <span className="text-xs text-gray-400">
                        {task.pomodoroCount}/{task.pomodoroTarget}
                    </span>
                </div>
            )}
        </div>
    );
};

export default TaskCard;
