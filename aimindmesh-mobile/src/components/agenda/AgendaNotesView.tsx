import React, { useState } from 'react';
import AgendaMonthView from '../calendar/AgendaMonthView';
import { AgendaNoteEditor } from './AgendaNoteEditor';

import { LLMConfig, Personality } from '../../types';

interface AgendaNotesViewProps {
    showSystemCalendar?: boolean;
    llmConfig?: LLMConfig;
    apiKey?: string;
    personality?: Personality;
}

export const AgendaNotesView: React.FC<AgendaNotesViewProps> = ({
    showSystemCalendar = false,
    llmConfig,
    apiKey,
    personality,
}) => {
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);

    return (
        <div className="flex h-full w-full overflow-hidden relative">
            {/* Sidebar Toggle Button (Floating or Integrated) */}
            <button
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className={`
                    absolute z-20 top-2 left-2 p-2 rounded-lg 
                    ${isSidebarOpen
                        ? 'bg-transparent text-gray-400 hover:text-white'
                        : 'bg-surface border border-white/10 text-white shadow-lg'}
                    transition-all duration-300
                `}
                title={isSidebarOpen ? "Close Sidebar" : "Open Calendar"}
            >
                {isSidebarOpen ? (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                    </svg>
                ) : (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                    </svg>
                )}
            </button>

            {/* Sidebar (Calendar) */}
            <div
                className={`
                    h-full bg-surface border-r border-white/10 transition-all duration-300 ease-in-out
                    flex flex-col relative
                    ${isSidebarOpen ? 'w-80 translate-x-0' : 'w-0 -translate-x-full opacity-0 overflow-hidden'}
                `}
            >
                {/* Adjust padding for the toggle button space */}
                <div className="pt-12 px-2 flex-1 overflow-hidden">
                    <AgendaMonthView
                        initialDate={selectedDate}
                        showSystemCalendar={showSystemCalendar}
                        onSelectDate={(date) => {
                            setSelectedDate(date);
                            // Optional: auto-close sidebar on mobile?
                            // setIsSidebarOpen(false); 
                        }}
                    />
                </div>
            </div>

            {/* Main Content (Editor) */}
            <div className="flex-1 h-full overflow-hidden bg-background relative flex flex-col">
                <div className="flex-1 p-4 md:p-6 overflow-hidden">
                    <AgendaNoteEditor
                        date={selectedDate}
                        llmConfig={llmConfig}
                        apiKey={apiKey}
                        personality={personality}
                    />
                </div>
            </div>
        </div>
    );
};
