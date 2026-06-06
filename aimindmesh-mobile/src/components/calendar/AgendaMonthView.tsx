/**
 * Agenda Month View Component
 * Calendar grid showing the month with event/note indicators
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
    getMonthName,
    getShortDayNames,
    formatDateString,
    isToday,
    getMonthData,
} from '../../services/calendar/calendarService';

interface AgendaMonthViewProps {
    initialDate?: Date;
    showSystemCalendar: boolean;
    onSelectDate: (date: Date) => void;
}

interface DayData {
    hasEvents: boolean;
    hasNotes: boolean;
    eventCount: number;
    noteCount: number;
}

const AgendaMonthView: React.FC<AgendaMonthViewProps> = ({
    initialDate = new Date(),
    showSystemCalendar,
    onSelectDate,
}) => {
    const [currentDate, setCurrentDate] = useState(new Date(initialDate));
    const [monthData, setMonthData] = useState<Map<string, DayData>>(new Map());
    const [isLoading, setIsLoading] = useState(false);

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    // Load month data
    useEffect(() => {
        const loadMonthData = async () => {
            setIsLoading(true);
            try {
                const data = await getMonthData(year, month, showSystemCalendar);
                setMonthData(data);
            } catch (error) {
                console.error('Failed to load month data:', error);
            } finally {
                setIsLoading(false);
            }
        };
        loadMonthData();
    }, [year, month, showSystemCalendar]);

    // Calculate calendar grid
    const calendarDays = useMemo(() => {
        const firstDayOfMonth = new Date(year, month, 1);
        const lastDayOfMonth = new Date(year, month + 1, 0);
        const daysInMonth = lastDayOfMonth.getDate();

        // Get day of week (0 = Sunday, adjust for Monday start)
        let startDay = firstDayOfMonth.getDay();
        // Convert to Monday-start week (0 = Monday)
        startDay = startDay === 0 ? 6 : startDay - 1;

        const days: Array<{ date: Date | null; dayNum: number | null }> = [];

        // Add empty cells before the first day
        for (let i = 0; i < startDay; i++) {
            days.push({ date: null, dayNum: null });
        }

        // Add days of the month
        for (let day = 1; day <= daysInMonth; day++) {
            days.push({
                date: new Date(year, month, day),
                dayNum: day,
            });
        }

        // Fill remaining cells to complete the grid (6 rows max)
        while (days.length % 7 !== 0) {
            days.push({ date: null, dayNum: null });
        }

        return days;
    }, [year, month]);

    const goToPreviousMonth = () => {
        setCurrentDate(new Date(year, month - 1, 1));
    };

    const goToNextMonth = () => {
        setCurrentDate(new Date(year, month + 1, 1));
    };

    const goToToday = () => {
        setCurrentDate(new Date());
    };

    const dayNames = getShortDayNames();
    // Reorder for Monday-start week
    const mondayFirstDays = [...dayNames.slice(1), dayNames[0]];

    return (
        <div className="flex flex-col h-full bg-input">
            {/* Month Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-surface border-b border-white/10">
                <button
                    onClick={goToPreviousMonth}
                    className="p-2 hover:bg-white/10 rounded-full transition-colors"
                >
                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                </button>

                <div className="text-center">
                    <h2 className="text-lg font-semibold text-white">
                        {getMonthName(month)} {year}
                    </h2>
                    <button
                        onClick={goToToday}
                        className="text-xs text-primary-light hover:text-primary transition-colors"
                    >
                        Today
                    </button>
                </div>

                <button
                    onClick={goToNextMonth}
                    className="p-2 hover:bg-white/10 rounded-full transition-colors"
                >
                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                </button>
            </div>

            {/* Day Names Header */}
            <div className="grid grid-cols-7 bg-surface border-b border-white/10">
                {mondayFirstDays.map((day, index) => (
                    <div
                        key={day}
                        className={`py-2 text-center text-xs font-medium ${index >= 5 ? 'text-gray-400' : 'text-gray-300'
                            }`}
                    >
                        {day}
                    </div>
                ))}
            </div>

            {/* Calendar Grid */}
            <div className="flex-1 overflow-auto">
                <div className="grid grid-cols-7 gap-px bg-white/5">
                    {calendarDays.map((cell, index) => {
                        if (!cell.date || !cell.dayNum) {
                            return (
                                <div key={index} className="aspect-square bg-input/50" />
                            );
                        }

                        const dateStr = formatDateString(cell.date);
                        const data = monthData.get(dateStr);
                        const isTodayDate = isToday(cell.date);
                        const isWeekend = cell.date.getDay() === 0 || cell.date.getDay() === 6;

                        return (
                            <button
                                key={dateStr}
                                onClick={() => onSelectDate(cell.date!)}
                                className={`
                  aspect-square p-1 flex flex-col items-center justify-start 
                  transition-colors hover:bg-primary/20
                  ${isTodayDate ? 'bg-primary/30' : 'bg-input'}
                `}
                            >
                                <span
                                    className={`
                    w-7 h-7 flex items-center justify-center rounded-full text-sm
                    ${isTodayDate ? 'bg-primary text-white font-bold' : ''}
                    ${isWeekend && !isTodayDate ? 'text-gray-400' : 'text-white'}
                  `}
                                >
                                    {cell.dayNum}
                                </span>

                                {/* Indicators */}
                                {(data?.hasEvents || data?.hasNotes) && (
                                    <div className="flex gap-1 mt-1">
                                        {data.hasEvents && (
                                            <span className="w-1.5 h-1.5 rounded-full bg-blue-400" title="Events" />
                                        )}
                                        {data.hasNotes && (
                                            <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" title="Notes" />
                                        )}
                                    </div>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Loading Overlay */}
            {isLoading && (
                <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
            )}
        </div>
    );
};

export default AgendaMonthView;
