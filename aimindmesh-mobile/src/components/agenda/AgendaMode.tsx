/**
 * Agenda Mode Component
 * Main container for Calendar, Notes, and Task Management functionality
 * Handles navigation between Month, Day, and Kanban views
 */

import React, { useState, useEffect, useCallback } from 'react';
import AgendaMonthView from '../calendar/AgendaMonthView';
import AgendaDayView from '../calendar/AgendaDayView';
import { KanbanBoard } from './tasks';
import { AgendaNotesView } from './AgendaNotesView';
import TaskArchitectView from '../../views/TaskArchitectView';
import { initCalendarDatabase } from '../../services/calendar/calendarService';
import { migrateTasksTable } from '../../services/calendar/taskDatabase';
import { logger } from '../../services/logger';
import { LLMConfig, Personality, AIMindMeshServerSettings } from '../../types';

export type AgendaView = 'month' | 'day' | 'kanban' | 'notes' | 'architect';

interface AgendaModeProps {
    onClose: () => void;
    defaultView?: AgendaView;
    showSystemCalendar?: boolean;
    llmConfig?: LLMConfig;
    apiKey?: string;
    personality?: Personality;
    serverSettings?: AIMindMeshServerSettings;
}

const AgendaMode: React.FC<AgendaModeProps> = ({
    onClose,
    defaultView = 'month',
    showSystemCalendar = false,
    llmConfig,
    apiKey,
    personality,
    serverSettings,
}) => {
    const [currentView, setCurrentView] = useState<AgendaView>(defaultView);
    const [selectedDate, setSelectedDate] = useState<Date>(new Date());
    const [isInitialized, setIsInitialized] = useState(false);
    const [initError, setInitError] = useState<string | null>(null);

    // Sync currentView with defaultView if it changes (for deep links)
    useEffect(() => {
        if (defaultView) {
            setCurrentView(defaultView);
        }
    }, [defaultView]);

    // Initialize database on mount
    useEffect(() => {
        const init = async () => {
            try {
                await initCalendarDatabase();
                // Migrate tasks table if needed (v2.8+)
                await migrateTasksTable();
                setIsInitialized(true);
                logger.log('info', '[AgendaMode] Calendar and Tasks database initialized');
            } catch (error) {
                logger.log('error', '[AgendaMode] Failed to initialize database', error);
                setInitError('Database initialization error');
            }
        };
        init();
    }, []);

    const handleSelectDate = useCallback((date: Date) => {
        setSelectedDate(date);
        setCurrentView('day');
    }, []);

    const handleBackToMonth = useCallback(() => {
        setCurrentView('month');
    }, []);

    const handleEventUpdated = useCallback(() => {
        // Could trigger a refresh of month view indicators
        // The components handle their own data loading
    }, []);

    // Loading state
    if (!isInitialized && !initError) {
        return (
            <div className="fixed inset-0 z-50 bg-background flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
                    <p className="text-gray-400">Loading Agenda...</p>
                </div>
            </div>
        );
    }

    // Error state
    if (initError) {
        return (
            <div className="fixed inset-0 z-50 bg-background flex items-center justify-center">
                <div className="text-center p-6">
                    <div className="text-red-400 text-4xl mb-4">⚠️</div>
                    <p className="text-white mb-4">{initError}</p>
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-50 bg-background flex flex-col pt-safe pb-safe">
            {/* Top Bar */}
            <div className="flex items-center justify-between px-4 py-3 bg-surface border-b border-white/10">
                <div className="flex items-center gap-3">
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-white/10 rounded-full transition-colors"
                        aria-label="Close"
                    >
                        <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                    <h1 className="text-xl font-bold text-white">Agenda</h1>
                </div>

                {/* View Toggle */}
                <div className="flex bg-white/10 rounded-lg p-1">
                    <button
                        onClick={() => setCurrentView('month')}
                        className={`
                            px-3 py-1.5 rounded-md text-sm font-medium transition-colors
                            ${currentView === 'month' ? 'bg-primary text-white' : 'text-gray-400 hover:text-white'}
                        `}
                    >
                        Month
                    </button>
                    <button
                        onClick={() => setCurrentView('day')}
                        className={`
                            px-3 py-1.5 rounded-md text-sm font-medium transition-colors
                            ${currentView === 'day' ? 'bg-primary text-white' : 'text-gray-400 hover:text-white'}
                        `}
                    >
                        Day
                    </button>
                    <button
                        onClick={() => setCurrentView('kanban')}
                        className={`
                            px-3 py-1.5 rounded-md text-sm font-medium transition-colors
                            ${currentView === 'kanban' ? 'bg-primary text-white' : 'text-gray-400 hover:text-white'}
                        `}
                    >
                        📊 Tasks
                    </button>
                    <button
                        onClick={() => setCurrentView('notes')}
                        className={`
                            px-3 py-1.5 rounded-md text-sm font-medium transition-colors
                            ${currentView === 'notes' ? 'bg-primary text-white' : 'text-gray-400 hover:text-white'}
                        `}
                    >
                        📝 Notes
                    </button>
                    <button
                        onClick={() => setCurrentView('architect')}
                        className={`
                            px-3 py-1.5 rounded-md text-sm font-medium transition-colors
                            ${currentView === 'architect' ? 'bg-primary text-white' : 'text-gray-400 hover:text-white'}
                        `}
                    >
                        🏗️ Tasks
                    </button>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden relative">
                {currentView === 'month' && (
                    <AgendaMonthView
                        initialDate={selectedDate}
                        showSystemCalendar={showSystemCalendar}
                        onSelectDate={handleSelectDate}
                    />
                )}
                {currentView === 'day' && (
                    <AgendaDayView
                        date={selectedDate}
                        showSystemCalendar={showSystemCalendar}
                        onBack={handleBackToMonth}
                        onEventUpdated={handleEventUpdated}
                    />
                )}
                {currentView === 'kanban' && (
                    <KanbanBoard />
                )}
                {currentView === 'notes' && (
                    <AgendaNotesView
                        showSystemCalendar={showSystemCalendar}
                        llmConfig={llmConfig}
                        apiKey={apiKey}
                        personality={personality}
                    />
                )}
                {currentView === 'architect' && (
                    <TaskArchitectView serverSettings={serverSettings} />
                )}
            </div>
        </div>
    );
};

export default AgendaMode;
