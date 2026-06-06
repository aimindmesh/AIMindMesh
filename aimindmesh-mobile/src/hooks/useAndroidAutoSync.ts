import { useEffect, useRef } from 'react';
import { androidAutoService } from '../services/androidAuto/androidAutoService';
import { TodoItem } from '../services/todoTypes';
import { getAllEvents } from '../services/calendar/calendarService';
import { getKanbanBoard } from '../services/calendar/taskDatabase';
import { logger } from '../services/logger';
import { TaskStatus } from '../types/calendar';

interface AndroidAutoSettings {
    enabled: boolean;
    showCallMode: boolean;
    showCalendar: boolean;
    showToDo: boolean;
    showKanban: boolean;
}

export const useAndroidAutoSync = (
    todos: TodoItem[],
    settings: AndroidAutoSettings | undefined,
    dbReady: boolean = true
) => {
    const prevTodosRef = useRef<string>('');
    const prevSettingsRef = useRef<string>('');
    const prevCalendarRef = useRef<string>('');
    const prevKanbanRef = useRef<string>('');

    // Sync Settings
    useEffect(() => {
        if (!settings) return;

        const settingsStr = JSON.stringify(settings);
        if (settingsStr === prevSettingsRef.current) return;

        prevSettingsRef.current = settingsStr;

        logger.log('debug', '[AutoSync] Updating settings', settings);
        androidAutoService.updateSettings(settings).catch((err: any) =>
            logger.log('error', '[AutoSync] Failed to update settings', err)
        );
    }, [settings]);

    // Sync To-Do List
    useEffect(() => {
        if (!settings?.enabled || !settings?.showToDo) return;

        const activeTodos = todos.filter(t => !t.completedAt);
        const todoPayload = activeTodos.map(t => ({
            id: t.id,
            text: t.text,
            isCompleted: false
        }));

        const payloadStr = JSON.stringify(todoPayload);
        if (payloadStr === prevTodosRef.current) return;

        prevTodosRef.current = payloadStr;

        logger.log('debug', '[AutoSync] Syncing To-Do list', { count: activeTodos.length });
        androidAutoService.updateScreen('todo', payloadStr).catch((err: any) =>
            logger.log('error', '[AutoSync] Failed to sync To-Do', err)
        );

    }, [todos, settings?.enabled, settings?.showToDo]);

    // Sync Calendar (Periodic)
    useEffect(() => {
        if (!settings?.enabled || !settings?.showCalendar || !dbReady) return;

        const syncCalendar = async () => {
            try {
                const now = new Date();
                const nextWeek = new Date();
                nextWeek.setDate(now.getDate() + 7);

                const events = await getAllEvents(now, nextWeek, true);

                const eventPayload = events.map(e => ({
                    title: e.title,
                    startTime: e.startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    endTime: e.endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    description: e.location || e.notes || ''
                }));

                const payloadStr = JSON.stringify(eventPayload);
                if (payloadStr === prevCalendarRef.current) return;
                prevCalendarRef.current = payloadStr;

                await androidAutoService.updateScreen('calendar', payloadStr);
                logger.log('debug', '[AutoSync] Synced Calendar events', { count: events.length });
            } catch (error) {
                logger.log('error', '[AutoSync] Failed to sync Calendar', error);
            }
        };

        syncCalendar();
        const interval = setInterval(syncCalendar, 5 * 60 * 1000);
        return () => clearInterval(interval);

    }, [settings?.enabled, settings?.showCalendar, dbReady]);

    // Sync Kanban (Initial & Periodic fallback)
    useEffect(() => {
        if (!settings?.enabled || !settings?.showKanban || !dbReady) return;

        const syncKanban = async () => {
            try {
                const board = await getKanbanBoard();

                // Transform denormalized board to normalized structure expected by AutoUtils.java
                // Expected: { columns: { [id]: { title, taskIds: [] } }, columnOrder: [], tasks: { [id]: { content } } }

                const columnOrder: TaskStatus[] = ['backlog', 'todo', 'in-progress', 'review', 'done'];
                const columnTitles: Record<TaskStatus, string> = {
                    'backlog': 'Backlog',
                    'todo': 'To Do',
                    'in-progress': 'In Progress',
                    'review': 'Review',
                    'done': 'Done'
                };

                const columns: Record<string, any> = {};
                const tasks: Record<string, any> = {};

                columnOrder.forEach(status => {
                    const statusTasks = board[status] || [];
                    const taskIds = statusTasks.map(t => t.id);

                    columns[status] = {
                        id: status,
                        title: columnTitles[status],
                        taskIds: taskIds
                    };

                    statusTasks.forEach(t => {
                        tasks[t.id] = {
                            id: t.id,
                            content: t.title,
                            // Add other fields if needed by KanbanScreen.java
                        };
                    });
                });

                const normalizedBoard = {
                    columns,
                    columnOrder,
                    tasks
                };

                const payloadStr = JSON.stringify(normalizedBoard);
                if (payloadStr === prevKanbanRef.current) return;
                prevKanbanRef.current = payloadStr;

                await androidAutoService.updateScreen('kanban', payloadStr);
                logger.log('debug', '[AutoSync] Synced Kanban board');
            } catch (error) {
                logger.log('error', '[AutoSync] Failed to sync Kanban', error);
            }
        };

        syncKanban();
        const interval = setInterval(syncKanban, 5 * 60 * 1000); // Also sync on intent?
        // Ideally we should listen to DB changes, but interval is safe for now
        return () => clearInterval(interval);

    }, [settings?.enabled, settings?.showKanban, dbReady]);
};
