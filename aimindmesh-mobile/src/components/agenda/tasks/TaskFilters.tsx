/**
 * Task Filters Component
 * Filter panel for the Kanban board
 */

import React, { useState } from 'react';
import { TaskFilterOptions, TaskPriority } from '../../../types/calendar';

interface TaskFiltersProps {
    onFilterChange: (filters: TaskFilterOptions) => void;
}

const TaskFilters: React.FC<TaskFiltersProps> = ({ onFilterChange }) => {
    const [filters, setFilters] = useState<TaskFilterOptions>({});

    const updateFilter = (key: keyof TaskFilterOptions, value: any) => {
        const newFilters = { ...filters, [key]: value };

        // Remove empty values
        if (!value || (Array.isArray(value) && value.length === 0)) {
            delete newFilters[key];
        }

        setFilters(newFilters);
        onFilterChange(newFilters);
    };

    const clearFilters = () => {
        setFilters({});
        onFilterChange({});
    };

    const hasActiveFilters = Object.keys(filters).length > 0;

    return (
        <div className="bg-input border-b border-white/10 p-4">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                    </svg>
                    Filters
                </h3>

                {hasActiveFilters && (
                    <button
                        onClick={clearFilters}
                        className="text-sm text-primary hover:underline flex items-center gap-1"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        Clear all
                    </button>
                )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                {/* Priority Filter */}
                <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">
                        Priority
                    </label>
                    <div className="space-y-1">
                        {(['urgent', 'high', 'medium', 'low'] as TaskPriority[]).map(priority => (
                            <label key={priority} className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer hover:text-white">
                                <input
                                    type="checkbox"
                                    checked={filters.priority?.includes(priority) || false}
                                    onChange={(e) => {
                                        const current = filters.priority || [];
                                        const updated = e.target.checked
                                            ? [...current, priority]
                                            : current.filter(p => p !== priority);
                                        updateFilter('priority', updated);
                                    }}
                                    className="rounded border-gray-600 bg-input text-primary focus:ring-primary"
                                />
                                {priority === 'urgent' && '🔴 Urgent'}
                                {priority === 'high' && '🟠 High'}
                                {priority === 'medium' && '🔵 Medium'}
                                {priority === 'low' && '⚪ Low'}
                            </label>
                        ))}
                    </div>
                </div>

                {/* Date Range */}
                <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">
                        Due Date
                    </label>
                    <select
                        onChange={(e) => {
                            const value = e.target.value;
                            if (value === 'all') {
                                updateFilter('dateRange', undefined);
                            } else if (value === 'today') {
                                const today = new Date();
                                today.setHours(0, 0, 0, 0);
                                const endOfDay = new Date();
                                endOfDay.setHours(23, 59, 59, 999);
                                updateFilter('dateRange', { start: today, end: endOfDay });
                            } else if (value === 'week') {
                                const now = new Date();
                                const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
                                updateFilter('dateRange', { start: now, end: weekLater });
                            } else if (value === 'overdue') {
                                const now = new Date();
                                const pastDate = new Date(0);
                                updateFilter('dateRange', { start: pastDate, end: now });
                            }
                        }}
                        className="w-full px-3 py-2 bg-surface border border-white/10 rounded-lg text-sm text-white"
                    >
                        <option value="all">Any date</option>
                        <option value="today">Today</option>
                        <option value="week">Next 7 days</option>
                        <option value="overdue">Overdue</option>
                    </select>
                </div>

                {/* Special Filters */}
                <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">
                        Special
                    </label>
                    <div className="space-y-1">
                        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer hover:text-white">
                            <input
                                type="checkbox"
                                checked={filters.hasSubtasks || false}
                                onChange={(e) => updateFilter('hasSubtasks', e.target.checked || undefined)}
                                className="rounded border-gray-600 bg-input text-primary focus:ring-primary"
                            />
                            Has subtasks
                        </label>
                        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer hover:text-white">
                            <input
                                type="checkbox"
                                checked={filters.hasPomodoroTarget || false}
                                onChange={(e) => updateFilter('hasPomodoroTarget', e.target.checked || undefined)}
                                className="rounded border-gray-600 bg-input text-primary focus:ring-primary"
                            />
                            Has pomodoro 🍅
                        </label>
                    </div>
                </div>

                {/* Assignee Filter */}
                <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">
                        Assignee
                    </label>
                    <select
                        onChange={(e) => {
                            const value = e.target.value;
                            if (value === 'all') {
                                updateFilter('assignee', undefined);
                            } else {
                                updateFilter('assignee', value as 'user' | 'ai');
                            }
                        }}
                        value={filters.assignee || 'all'}
                        className="w-full px-3 py-2 bg-surface border border-white/10 rounded-lg text-sm text-white"
                    >
                        <option value="all">Anyone</option>
                        <option value="user">Me (User)</option>
                        <option value="ai">AI 🤖</option>
                    </select>
                </div>

                {/* Tags Filter */}
                <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">
                        Tags
                    </label>
                    <input
                        type="text"
                        placeholder="Search tags..."
                        onChange={(e) => {
                            const tags = e.target.value
                                .split(',')
                                .map(t => t.trim())
                                .filter(Boolean);
                            updateFilter('tags', tags.length > 0 ? tags : undefined);
                        }}
                        className="w-full px-3 py-2 bg-surface border border-white/10 rounded-lg text-sm 
                            text-white placeholder-gray-500"
                    />
                </div>
            </div>
        </div>
    );
};

export default TaskFilters;
