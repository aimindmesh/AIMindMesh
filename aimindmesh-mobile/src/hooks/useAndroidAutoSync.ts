import { useEffect, useRef } from 'react';
import { androidAutoService, buildAutoCalendarPayload } from '../services/androidAuto/androidAutoService';
import { TodoItem } from '../services/todoTypes';
import { getAllEvents, systemCalendarVisible } from '../services/calendar/calendarService';
import { getKanbanBoard, buildAutoKanbanPayload } from '../services/calendar/taskDatabase';
import { logger } from '../services/logger';

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

                // System events only when the Agenda shows them, never with a permission prompt
                const events = await getAllEvents(now, nextWeek, await systemCalendarVisible());

                const payloadStr = buildAutoCalendarPayload(events, now);
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
                // Same normalized shape as the sync after each task change (AutoUtils.java reads it)
                const payloadStr = buildAutoKanbanPayload(board);
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
