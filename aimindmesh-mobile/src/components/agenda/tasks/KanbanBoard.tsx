/**
 * Kanban Board Component
 * Main view for task management with drag-and-drop columns
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
    DragDropContext,
    Droppable,
    Draggable,
    DropResult
} from 'react-beautiful-dnd';
import { CalendarTask, TaskStatus, KanbanBoard as KanbanBoardType, TaskStats, TaskFilterOptions } from '../../../types/calendar';
import * as TaskDB from '../../../services/calendar/taskDatabase';
import { logger } from '../../../services/logger';
import TaskCard from './TaskCard';
import TaskDetailModal from './TaskDetailModal';
import TaskFilters from './TaskFilters';

// Column configuration
const COLUMNS: Array<{
    id: TaskStatus;
    title: string;
    icon: string;
    colorClass: string;
    bgClass: string;
}> = [
        { id: 'backlog', title: 'Backlog', icon: '📋', colorClass: 'text-gray-300', bgClass: 'bg-gray-700/50' },
        { id: 'todo', title: 'To Do', icon: '📝', colorClass: 'text-blue-300', bgClass: 'bg-blue-900/30' },
        { id: 'in-progress', title: 'In Progress', icon: '🚀', colorClass: 'text-yellow-300', bgClass: 'bg-yellow-900/30' },
        { id: 'review', title: 'Review', icon: '👀', colorClass: 'text-purple-300', bgClass: 'bg-purple-900/30' },
        { id: 'done', title: 'Done', icon: '✅', colorClass: 'text-green-300', bgClass: 'bg-green-900/30' }
    ];

interface KanbanBoardProps {
    onTaskSelect?: (task: CalendarTask) => void;
}

const KanbanBoard: React.FC<KanbanBoardProps> = ({ onTaskSelect }) => {
    const [board, setBoard] = useState<KanbanBoardType>({
        backlog: [],
        todo: [],
        'in-progress': [],
        review: [],
        done: []
    });
    const [stats, setStats] = useState<TaskStats | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showFilters, setShowFilters] = useState(false);
    const [selectedTask, setSelectedTask] = useState<CalendarTask | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [activeFilters, setActiveFilters] = useState<TaskFilterOptions>({});

    const loadBoard = useCallback(async () => {
        try {
            const data = await TaskDB.getKanbanBoard();
            setBoard(data);
        } catch (error) {
            logger.log('error', '[KanbanBoard] Failed to load board', error);
        }
    }, []);

    const aiActiveCount = Object.values(board).flat().filter(
        t => t.assignee === 'ai' && ['scheduled', 'queued', 'running'].includes(t.aiConfig?.lastExecution?.status || '')
    ).length;

    const loadStats = useCallback(async () => {
        try {
            const data = await TaskDB.getTaskStats();
            setStats(data);
        } catch (error) {
            logger.log('error', '[KanbanBoard] Failed to load stats', error);
        }
    }, []);

    useEffect(() => {
        const init = async () => {
            setIsLoading(true);
            await TaskDB.migrateTasksTable();
            await loadBoard();
            await loadStats();
            setIsLoading(false);
        };
        init();
    }, [loadBoard, loadStats]);

    const handleDragEnd = async (result: DropResult) => {
        const { source, destination, draggableId } = result;

        if (!destination) return;

        if (
            source.droppableId === destination.droppableId &&
            source.index === destination.index
        ) {
            return;
        }

        // Optimistic update
        const sourceStatus = source.droppableId as TaskStatus;
        const destStatus = destination.droppableId as TaskStatus;

        const newBoard = { ...board };
        const [movedTask] = newBoard[sourceStatus].splice(source.index, 1);

        // Update the task status
        const updatedTask = { ...movedTask, status: destStatus };
        newBoard[destStatus].splice(destination.index, 0, updatedTask);

        setBoard(newBoard);

        try {
            // Update database
            await TaskDB.moveTask(draggableId, destStatus, destination.index);
            await TaskDB.reorderTasks(destStatus, newBoard[destStatus].map(t => t.id));

            // Reload stats
            await loadStats();
        } catch (error) {
            logger.log('error', '[KanbanBoard] Failed to move task', error);
            // Revert on error
            await loadBoard();
        }
    };

    const handleCreateTask = () => {
        setSelectedTask(null);
        setShowCreateModal(true);
    };

    const handleTaskClick = (task: CalendarTask) => {
        setSelectedTask(task);
        setShowCreateModal(true);
        onTaskSelect?.(task);
    };

    const handleModalClose = async () => {
        setShowCreateModal(false);
        setSelectedTask(null);
        await loadBoard();
        await loadStats();
    };

    if (isLoading) {
        return (
            <div className="h-full flex items-center justify-center bg-background">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
                    <p className="text-gray-400">Loading tasks...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-background">
            {/* Header */}
            <div className="p-4 bg-surface border-b border-white/10">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        📊 Task Board
                    </h2>

                    <div className="flex gap-2">
                        <button
                            onClick={() => setShowFilters(!showFilters)}
                            className={`px-3 py-2 rounded-lg transition flex items-center gap-2 ${showFilters
                                ? 'bg-primary text-white'
                                : 'bg-white/10 text-gray-300 hover:bg-white/20'
                                }`}
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                                />
                            </svg>
                            Filters
                        </button>

                        <button
                            onClick={handleCreateTask}
                            className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition flex items-center gap-2"
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            New Task
                        </button>
                    </div>
                </div>

                {/* Stats Bar */}
                {stats && (
                    <div className="flex gap-6 text-sm flex-wrap">
                        <div className="flex items-center gap-2">
                            <span className="text-gray-400">Total:</span>
                            <strong className="text-white">{stats.total}</strong>
                        </div>

                        <div className="flex items-center gap-2">
                            <span className="text-red-400">Overdue:</span>
                            <strong className="text-red-400">{stats.overdue}</strong>
                        </div>

                        <div className="flex items-center gap-2">
                            <span className="text-green-400">This week:</span>
                            <strong className="text-green-400">{stats.completedThisWeek}</strong>
                        </div>

                        <div className="flex items-center gap-2">
                            <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                            </svg>
                            <span className="text-gray-400">Completion:</span>
                            <strong className="text-blue-400">{stats.completionRate}%</strong>
                        </div>
                    </div>
                )}
            </div>

            {/* Filters Panel */}
            {showFilters && (
                <TaskFilters
                    onFilterChange={(filters) => {
                        setActiveFilters(filters);
                    }}
                />
            )}

            {/* AI Active Tasks Banner */}
            {aiActiveCount > 0 && (
                <div className="bg-indigo-900/40 border border-indigo-500/50 m-4 mb-0 p-3 rounded-lg flex items-center justify-between">
                    <div className="flex items-center gap-2 text-indigo-300 text-sm">
                        <span className="text-xl animate-pulse">🤖</span>
                        <strong>{aiActiveCount} AI Task{aiActiveCount > 1 ? 's' : ''}</strong> {aiActiveCount === 1 ? 'is' : 'are'} currently running or queued on the Server.
                    </div>
                </div>
            )}

            {/* Kanban Columns */}
            <div className="flex-1 overflow-x-auto p-4">
                <DragDropContext onDragEnd={handleDragEnd}>
                    <div className="flex gap-4 h-full min-w-max">
                        {COLUMNS.map(column => (
                            <div
                                key={column.id}
                                className="flex-shrink-0 w-72 flex flex-col"
                            >
                                {/* Column Header */}
                                <div className={`${column.bgClass} rounded-t-lg p-3 border-b border-white/10`}>
                                    <h3 className={`font-semibold flex items-center justify-between ${column.colorClass}`}>
                                        <span className="flex items-center gap-2">
                                            <span className="text-xl">{column.icon}</span>
                                            {column.title}
                                        </span>
                                        <span className="text-sm bg-white/10 px-2 py-1 rounded-full">
                                            {board[column.id].length}
                                        </span>
                                    </h3>
                                </div>

                                {/* Column Content */}
                                <Droppable droppableId={column.id}>
                                    {(provided, snapshot) => (
                                        <div
                                            ref={provided.innerRef}
                                            {...provided.droppableProps}
                                            className={`flex-1 bg-surface/50 rounded-b-lg p-2 space-y-2 
                                                overflow-y-auto transition-colors ${snapshot.isDraggingOver
                                                    ? 'bg-primary/20 ring-2 ring-primary/50'
                                                    : ''
                                                }`}
                                            style={{ minHeight: '400px' }}
                                        >
                                            {board[column.id].filter(task => {
                                                if (activeFilters.assignee && task.assignee !== activeFilters.assignee) return false;
                                                if (activeFilters.priority && activeFilters.priority.length > 0 && !activeFilters.priority.includes(task.priority)) return false;
                                                if (activeFilters.hasSubtasks && !task.parentTaskId) return false; // Approximation
                                                if (activeFilters.hasPomodoroTarget && !task.pomodoroTarget) return false;
                                                if (activeFilters.tags && activeFilters.tags.length > 0) {
                                                    if (!activeFilters.tags.some(t => task.tags.includes(t))) return false;
                                                }
                                                return true;
                                            }).map((task, index) => (
                                                <Draggable
                                                    key={task.id}
                                                    draggableId={task.id}
                                                    index={index}
                                                >
                                                    {(provided, snapshot) => (
                                                        <div
                                                            ref={provided.innerRef}
                                                            {...provided.draggableProps}
                                                            {...provided.dragHandleProps}
                                                            onClick={() => handleTaskClick(task)}
                                                            className={`cursor-pointer transition-all ${snapshot.isDragging
                                                                ? 'shadow-2xl rotate-2 scale-105'
                                                                : 'hover:scale-[1.02]'
                                                                }`}
                                                        >
                                                            <TaskCard task={task} />
                                                        </div>
                                                    )}
                                                </Draggable>
                                            ))}
                                            {provided.placeholder}

                                            {board[column.id].length === 0 && (
                                                <div className="text-center text-gray-500 py-8">
                                                    No tasks
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </Droppable>
                            </div>
                        ))}
                    </div>
                </DragDropContext>
            </div>

            {/* Task Detail Modal */}
            {showCreateModal && (
                <TaskDetailModal
                    task={selectedTask}
                    onClose={handleModalClose}
                />
            )}
        </div>
    );
};

export default KanbanBoard;
