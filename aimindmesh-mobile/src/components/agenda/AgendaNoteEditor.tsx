import React, { useState, useEffect, useCallback } from 'react';
import { NoteEditor } from '../notes/NoteEditor';
import { getDailyNote, saveDailyNote } from '../../services/calendar/calendarDatabase';
import { formatDateString } from '../../services/calendar/calendarService';
import { logger } from '../../services/logger';
import { LLMConfig, Personality } from '../../types';

interface AgendaNoteEditorProps {
    date: Date;
    llmConfig?: LLMConfig;
    apiKey?: string;
    personality?: Personality;
}

export const AgendaNoteEditor: React.FC<AgendaNoteEditorProps> = ({
    date,
    llmConfig,
    apiKey,
    personality,
}) => {
    const [noteContent, setNoteContent] = useState<string | undefined>(undefined);
    const [isLoading, setIsLoading] = useState(true);
    const [dateStr, setDateStr] = useState<string>('');

    useEffect(() => {
        const loadNote = async () => {
            setIsLoading(true);
            const formattedDate = formatDateString(date);
            setDateStr(formattedDate);
            try {
                const note = await getDailyNote(formattedDate);
                // If note exists, use its content. If not, undefined (which triggers default empty block in Editor)
                setNoteContent(note?.content || undefined);
            } catch (error) {
                logger.log('error', '[AgendaNoteEditor] Failed to load note', error);
            } finally {
                setIsLoading(false);
            }
        };
        loadNote();
    }, [date]);

    const handleSave = useCallback(async (content: string) => {
        if (!dateStr) return;
        try {
            await saveDailyNote(dateStr, content);
            logger.log('info', `[AgendaNoteEditor] Note saved for ${dateStr}`);
        } catch (error) {
            logger.log('error', '[AgendaNoteEditor] Failed to save note', error);
            // Could show a toast here
        }
    }, [dateStr]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
        );
    }

    // Force re-mount of editor when date changes to ensure fresh state
    return (
        <div className="agenda-note-editor flex flex-col h-full bg-surface/50 rounded-xl overflow-hidden border border-white/5">
            <div className="p-4 border-b border-white/10 flex justify-between items-center bg-surface">
                <div>
                    <h2 className="text-xl font-bold text-white">
                        Daily Notes
                    </h2>
                    <p className="text-sm text-gray-400">
                        {date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                    </p>
                </div>
                {/* Possible AI Actions or Export buttons here */}
            </div>

            <div className="flex-1 p-4 bg-transparent min-h-0 overflow-hidden flex flex-col">
                <NoteEditor
                    key={dateStr} // crucial for resetting editor state
                    initialContent={noteContent}
                    onSave={handleSave}
                    editable={true}
                    llmConfig={llmConfig}
                    apiKey={apiKey}
                    personality={personality}
                />
            </div>
        </div>
    );
};
