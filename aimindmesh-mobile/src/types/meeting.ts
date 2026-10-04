/**
 * Meeting-related types and interfaces
 */

import { LLMConfig, SpeechConfig } from '../types';

export interface WordTimestamp {
    word: string;
    start_ms: number;
    end_ms: number;
    confidence?: number;
}

export interface TranscriptSegment {
    id: string;
    speakerId: number;
    text: string;
    timestamp: number;
    // New fields for Tap-to-Play
    start_ms?: number;
    end_ms?: number;
    stt_provider?: string;
    confidence?: number;
    words?: WordTimestamp[];
    // New fields for Manual Editing
    originalText?: string;
    isEdited?: boolean;
    editedAt?: number;
    // Overlap detection
    overlap?: boolean;
}

/** A moment the user marked as important, as a position in the recording. */
export interface Bookmark {
    id: string;
    ms: number;
    note?: string;
}

/** An item of the AI analysis, with where it is discussed in the recording when known. */
export interface AnalysisPoint {
    text: string;
    atMs?: number;
}

export interface ActionItem {
    task: string;
    owner?: string;
    due?: string;
    atMs?: number;
}

export interface MeetingAnalysis {
    title: string;
    summary: string;
    keyPoints: AnalysisPoint[];
    decisions: AnalysisPoint[];
    actionItems: ActionItem[];
    openQuestions: AnalysisPoint[];
    /** The model's answer as is, when it could not be read as structured notes. */
    markdown?: string;
    source: 'transcript' | 'audio';
    model: string;
    createdAt: number;
}

/** A question asked about the meeting and the AI's answer. */
export interface MeetingQuestion {
    id: string;
    question: string;
    answer: string;
    createdAt: number;
}

/** What the user and the AI add to a meeting besides its transcript (synced with the server). */
export interface MeetingNotes {
    /** Set by the user, or taken from the AI analysis. */
    title: string;
    bookmarks: Bookmark[];
    analysis: MeetingAnalysis | null;
    questions: MeetingQuestion[];
}

export const EMPTY_NOTES: MeetingNotes = { title: '', bookmarks: [], analysis: null, questions: [] };

/**
 * A stored meeting. Notes are always present when loaded; when saving, a notes field left
 * undefined is not written (recovery, reprocessing and sync never erase the notes).
 */
export interface SavedMeeting extends Partial<MeetingNotes> {
    id: string;
    timestamp: number;
    transcript: TranscriptSegment[];
    speakerNames: Record<number, string>;
    duration: number;
    hasAudio: boolean;
    audioData?: string; // Base64 encoded audio data
    audioMimeType?: string; // MIME type of the audio
}

/** A meeting in the History list: everything but the transcript. */
export interface MeetingSummary extends MeetingNotes {
    id: string;
    timestamp: number;
    duration: number;
    hasAudio: boolean;
    segmentCount: number;
    speakerCount: number;
    /** The first sentence of the transcript, as a preview. */
    preview: string;
}

export interface MeetingModeProps {
    onClose: () => void;
    personality: any; // Using any for now to avoid circular deps
    llmConfig: LLMConfig;
    apiKey?: string;
    speechConfig?: SpeechConfig;
}

export type RecognitionMode = 'off' | 'fast' | 'precise';

/** Live transcription while recording; the accurate transcript is Whisper's, after (or during) it. */
export type TranscriptionMode = 'off' | 'vosk' | 'voxtral';
