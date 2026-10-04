import { useCallback, useRef } from 'react';
import { AIMindMeshServerSettings, LLMConfig } from '../../types';
import type { TaskKeys } from '../../services/llm/taskCompletion';
import { MeetingNotes, TranscriptSegment } from '../../types/meeting';
import { loadMeetingNotes, updateMeetingNotes } from '../../services/meeting/meetingRecords';
import { useMeetingAnalysis } from './useMeetingAnalysis';

interface Options {
    llmConfig: LLMConfig;
    keys: TaskKeys;
    serverSettings?: AIMindMeshServerSettings;
    showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
    /** The meeting on screen and its notes, read when a result arrives. */
    getScreen: () => { meetingId: string | null; notes: MeetingNotes };
    setNotes: React.Dispatch<React.SetStateAction<MeetingNotes>>;
    /** The automatic notes setting and the transcription language. */
    getAutoSettings: () => { enabled: boolean; language: string };
}

/**
 * AI notes and questions, stored with their meeting: in the screen state when the meeting is
 * on screen (the autosave writes it), else straight into the database.
 */
export function useMeetingNotesAI({ llmConfig, keys, serverSettings, showToast, getScreen, setNotes, getAutoSettings }: Options) {
    const optionsRef = useRef({ getScreen, getAutoSettings });
    optionsRef.current = { getScreen, getAutoSettings };
    const isOnScreen = (meetingId: string) => optionsRef.current.getScreen().meetingId === meetingId;

    const ai = useMeetingAnalysis({
        llmConfig,
        keys,
        serverSettings,
        showToast,
        onAnalysis: async (meetingId, analysis) => {
            if (isOnScreen(meetingId)) {
                setNotes(n => ({ ...n, analysis }));
            } else {
                await updateMeetingNotes(meetingId, { analysis });
            }
        },
        onQuestion: async (meetingId, question) => {
            if (isOnScreen(meetingId)) {
                setNotes(n => ({ ...n, questions: [...n.questions, question] }));
            } else {
                const stored = await loadMeetingNotes(meetingId);
                if (stored) await updateMeetingNotes(meetingId, { questions: [...stored.questions, question] });
            }
        }
    });

    const aiRef = useRef(ai);
    aiRef.current = ai;

    /** Writes the notes of a meeting whose transcript just became final, if the user asked for it. */
    const analyzeFinalTranscript = useCallback(async (meetingId: string, transcript: TranscriptSegment[], speakerNames: Record<number, string> = {}) => {
        const auto = optionsRef.current.getAutoSettings();
        if (!auto.enabled || !aiRef.current.isConfigured || transcript.length === 0) return;
        const stored = isOnScreen(meetingId)
            ? optionsRef.current.getScreen().notes
            : await loadMeetingNotes(meetingId).catch(() => null);
        aiRef.current.analyze({
            meetingId,
            transcript,
            speakerNames,
            bookmarks: stored?.bookmarks ?? [],
            questions: [],
            language: auto.language
        });
    }, []);

    return { ...ai, analyzeFinalTranscript };
}
