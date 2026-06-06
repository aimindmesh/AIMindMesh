export interface CalendarEvent {
    id: string;
    title: string;
    startTime: Date;
    endTime: Date;
    location?: string;
    notes?: string;
    isAllDay: boolean;
    isRecurring: boolean;
    recurrenceRule?: string;
    createdAt: Date;
    updatedAt: Date;
    isSystemEvent?: boolean; // For merged system calendar events
}

export interface CalendarNote {
    id: string;
    date: string; // YYYY-MM-DD
    content: string;
    category: string;
    createdAt: Date;
    updatedAt: Date;
}
