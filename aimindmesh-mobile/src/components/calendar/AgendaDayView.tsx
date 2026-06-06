/**
 * Agenda Day View Component
 * Shows events and notes for a specific day
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
    CalendarEvent,
    CalendarNote,
    getDayAgenda,
    formatTimeString,
    getDayName,
    getMonthName,
    addEvent,
    addNote,
    deleteEvent,
    deleteNote,
    formatDateString,
} from '../../services/calendar/calendarService';

interface AgendaDayViewProps {
    date: Date;
    showSystemCalendar: boolean;
    onBack: () => void;
    onEventUpdated?: () => void;
}

type NewItemType = 'event' | 'note' | null;

const AgendaDayView: React.FC<AgendaDayViewProps> = ({
    date,
    showSystemCalendar,
    onBack,
    onEventUpdated,
}) => {
    const [events, setEvents] = useState<CalendarEvent[]>([]);
    const [notes, setNotes] = useState<CalendarNote[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState<NewItemType>(null);

    // Form state for new event
    const [newEventTitle, setNewEventTitle] = useState('');
    const [newEventStartTime, setNewEventStartTime] = useState('09:00');
    const [newEventEndTime, setNewEventEndTime] = useState('10:00');
    const [newEventLocation, setNewEventLocation] = useState('');
    const [newEventNotes, setNewEventNotes] = useState('');
    const [newEventAllDay, setNewEventAllDay] = useState(false);

    // Form state for new note
    const [newNoteContent, setNewNoteContent] = useState('');
    const [newNoteCategory, setNewNoteCategory] = useState('general');

    const loadDayData = useCallback(async () => {
        setIsLoading(true);
        try {
            const data = await getDayAgenda(date, showSystemCalendar);
            setEvents(data.events);
            setNotes(data.notes);
        } catch (error) {
            console.error('Failed to load day data:', error);
        } finally {
            setIsLoading(false);
        }
    }, [date, showSystemCalendar]);

    useEffect(() => {
        loadDayData();
    }, [loadDayData]);

    const handleAddEvent = async () => {
        if (!newEventTitle.trim()) return;

        const [startHour, startMin] = newEventStartTime.split(':').map(Number);
        const [endHour, endMin] = newEventEndTime.split(':').map(Number);

        const startTime = new Date(date);
        startTime.setHours(startHour, startMin, 0, 0);

        const endTime = new Date(date);
        endTime.setHours(endHour, endMin, 0, 0);

        try {
            await addEvent({
                title: newEventTitle,
                startTime,
                endTime,
                location: newEventLocation || undefined,
                notes: newEventNotes || undefined,
                isAllDay: newEventAllDay,
                isRecurring: false,
            });

            // Reset form
            setNewEventTitle('');
            setNewEventStartTime('09:00');
            setNewEventEndTime('10:00');
            setNewEventLocation('');
            setNewEventNotes('');
            setNewEventAllDay(false);
            setShowAddModal(null);

            loadDayData();
            onEventUpdated?.();
        } catch (error) {
            console.error('Failed to add event:', error);
        }
    };

    const handleAddNote = async () => {
        if (!newNoteContent.trim()) return;

        try {
            await addNote({
                date: formatDateString(date),
                content: newNoteContent,
                category: newNoteCategory,
            });

            setNewNoteContent('');
            setNewNoteCategory('general');
            setShowAddModal(null);

            loadDayData();
            onEventUpdated?.();
        } catch (error) {
            console.error('Failed to add note:', error);
        }
    };

    const handleDeleteEvent = async (id: string, isSystem: boolean) => {
        if (isSystem) {
            alert('System events cannot be deleted from here.');
            return;
        }

        if (!confirm('Delete this event?')) return;

        try {
            await deleteEvent(id);
            loadDayData();
            onEventUpdated?.();
        } catch (error) {
            console.error('Failed to delete event:', error);
        }
    };

    const handleDeleteNote = async (id: string) => {
        if (!confirm('Delete this note?')) return;

        try {
            await deleteNote(id);
            loadDayData();
            onEventUpdated?.();
        } catch (error) {
            console.error('Failed to delete note:', error);
        }
    };

    const dayName = getDayName(date.getDay());
    const monthName = getMonthName(date.getMonth());

    return (
        <div className="flex flex-col h-full bg-input">
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 bg-surface border-b border-white/10">
                <button
                    onClick={onBack}
                    className="p-2 hover:bg-white/10 rounded-full transition-colors"
                >
                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                </button>
                <div>
                    <h2 className="text-lg font-semibold text-white">
                        {dayName} {date.getDate()} {monthName}
                    </h2>
                    <p className="text-xs text-gray-400">
                        {events.length} events · {notes.length} notes
                    </p>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-4 space-y-6 min-h-0">
                {/* Events Section */}
                <section>
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-medium text-gray-300 uppercase tracking-wide flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-blue-400" />
                            Events
                        </h3>
                        <button
                            onClick={() => setShowAddModal('event')}
                            className="text-xs text-primary hover:text-primary-light transition-colors"
                        >
                            + Add
                        </button>
                    </div>

                    {events.length === 0 ? (
                        <p className="text-sm text-gray-500 italic">No events</p>
                    ) : (
                        <div className="space-y-2">
                            {events.map((event) => (
                                <div
                                    key={event.id}
                                    className={`
                    p-3 rounded-lg border-l-4
                    ${event.isSystemEvent ? 'bg-blue-900/30 border-blue-500' : 'bg-surface border-primary'}
                  `}
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <h4 className="font-medium text-white">{event.title}</h4>
                                            <p className="text-sm text-gray-400">
                                                {event.isAllDay
                                                    ? 'All day'
                                                    : `${formatTimeString(event.startTime)} - ${formatTimeString(event.endTime)}`}
                                            </p>
                                            {event.location && (
                                                <p className="text-xs text-gray-500 mt-1">📍 {event.location}</p>
                                            )}
                                            {event.isSystemEvent && (
                                                <span className="text-xs text-blue-400 mt-1 inline-block">System</span>
                                            )}
                                        </div>
                                        <button
                                            onClick={() => handleDeleteEvent(event.id, !!event.isSystemEvent)}
                                            className="p-1 hover:bg-white/10 rounded transition-colors text-gray-400 hover:text-red-400"
                                        >
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                {/* Notes Section */}
                <section>
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-medium text-gray-300 uppercase tracking-wide flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-yellow-400" />
                            Notes
                        </h3>
                        <button
                            onClick={() => setShowAddModal('note')}
                            className="text-xs text-primary hover:text-primary-light transition-colors"
                        >
                            + Add
                        </button>
                    </div>

                    {notes.length === 0 ? (
                        <p className="text-sm text-gray-500 italic">No notes</p>
                    ) : (
                        <div className="space-y-2">
                            {notes.map((note) => {
                                // Helper to parse content
                                const getDisplayContent = (content: string) => {
                                    try {
                                        if (content.trim().startsWith('[') || content.trim().startsWith('{')) {
                                            const parsed = JSON.parse(content);
                                            if (Array.isArray(parsed)) {
                                                // It's likely BlockNote data
                                                return parsed.map(block => {
                                                    if (Array.isArray(block.content)) {
                                                        return block.content.map((c: any) => c.text || '').join('');
                                                    }
                                                    return '';
                                                }).filter(Boolean).join('\n') || 'Empty note';
                                            }
                                        }
                                    } catch (e) {
                                        // Not JSON, return as is
                                    }
                                    return content;
                                };

                                return (
                                    <div
                                        key={note.id}
                                        className="p-3 rounded-lg bg-yellow-900/20 border-l-4 border-yellow-500"
                                    >
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1">
                                                <p className="text-white whitespace-pre-wrap">{getDisplayContent(note.content)}</p>
                                                <span className="text-xs text-yellow-400/70 mt-1 inline-block">
                                                    {note.category}
                                                </span>
                                            </div>
                                            <button
                                                onClick={() => handleDeleteNote(note.id)}
                                                className="p-1 hover:bg-white/10 rounded transition-colors text-gray-400 hover:text-red-400"
                                            >
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                </svg>
                                            </button>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </section>
            </div>

            {/* Loading */}
            {isLoading && (
                <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
            )}

            {/* Add Event Modal */}
            {showAddModal === 'event' && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                    <div className="bg-surface rounded-xl w-full max-w-md p-5 space-y-4">
                        <h3 className="text-lg font-semibold text-white">New Event</h3>

                        <input
                            type="text"
                            placeholder="Title *"
                            value={newEventTitle}
                            onChange={(e) => setNewEventTitle(e.target.value)}
                            className="w-full px-3 py-2 bg-input text-white rounded-lg border border-white/20 focus:border-primary focus:outline-none"
                        />

                        <div className="flex items-center gap-2">
                            <label className="flex items-center gap-2 text-sm text-gray-300">
                                <input
                                    type="checkbox"
                                    checked={newEventAllDay}
                                    onChange={(e) => setNewEventAllDay(e.target.checked)}
                                    className="rounded"
                                />
                                All day
                            </label>
                        </div>

                        {!newEventAllDay && (
                            <div className="flex gap-3">
                                <div className="flex-1">
                                    <label className="text-xs text-gray-400">Start</label>
                                    <input
                                        type="time"
                                        value={newEventStartTime}
                                        onChange={(e) => setNewEventStartTime(e.target.value)}
                                        className="w-full px-3 py-2 bg-input text-white rounded-lg border border-white/20 focus:border-primary focus:outline-none"
                                    />
                                </div>
                                <div className="flex-1">
                                    <label className="text-xs text-gray-400">End</label>
                                    <input
                                        type="time"
                                        value={newEventEndTime}
                                        onChange={(e) => setNewEventEndTime(e.target.value)}
                                        className="w-full px-3 py-2 bg-input text-white rounded-lg border border-white/20 focus:border-primary focus:outline-none"
                                    />
                                </div>
                            </div>
                        )}

                        <input
                            type="text"
                            placeholder="Location (optional)"
                            value={newEventLocation}
                            onChange={(e) => setNewEventLocation(e.target.value)}
                            className="w-full px-3 py-2 bg-input text-white rounded-lg border border-white/20 focus:border-primary focus:outline-none"
                        />

                        <textarea
                            placeholder="Notes (optional)"
                            value={newEventNotes}
                            onChange={(e) => setNewEventNotes(e.target.value)}
                            rows={2}
                            className="w-full px-3 py-2 bg-input text-white rounded-lg border border-white/20 focus:border-primary focus:outline-none resize-none"
                        />

                        <div className="flex gap-3 pt-2">
                            <button
                                onClick={() => setShowAddModal(null)}
                                className="flex-1 py-2 px-4 bg-gray-600 hover:bg-gray-500 text-white rounded-lg transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleAddEvent}
                                disabled={!newEventTitle.trim()}
                                className="flex-1 py-2 px-4 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors disabled:opacity-50"
                            >
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Add Note Modal */}
            {showAddModal === 'note' && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                    <div className="bg-surface rounded-xl w-full max-w-md p-5 space-y-4">
                        <h3 className="text-lg font-semibold text-white">New Note</h3>

                        <textarea
                            placeholder="Content *"
                            value={newNoteContent}
                            onChange={(e) => setNewNoteContent(e.target.value)}
                            rows={4}
                            className="w-full px-3 py-2 bg-input text-white rounded-lg border border-white/20 focus:border-primary focus:outline-none resize-none"
                        />

                        <select
                            value={newNoteCategory}
                            onChange={(e) => setNewNoteCategory(e.target.value)}
                            className="w-full px-3 py-2 bg-input text-white rounded-lg border border-white/20 focus:border-primary focus:outline-none"
                        >
                            <option value="general">General</option>
                            <option value="personal">Personal</option>
                            <option value="work">Work</option>
                            <option value="shopping">Shopping</option>
                            <option value="idea">Idea</option>
                        </select>

                        <div className="flex gap-3 pt-2">
                            <button
                                onClick={() => setShowAddModal(null)}
                                className="flex-1 py-2 px-4 bg-gray-600 hover:bg-gray-500 text-white rounded-lg transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleAddNote}
                                disabled={!newNoteContent.trim()}
                                className="flex-1 py-2 px-4 bg-yellow-600 hover:bg-yellow-500 text-white rounded-lg transition-colors disabled:opacity-50"
                            >
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AgendaDayView;
