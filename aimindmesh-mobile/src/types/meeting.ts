/**
 * Meeting-related types and interfaces
 */

import { LLMConfig, Memory, SpeechConfig } from '../types';

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
}

export interface SavedMeeting {
    id: string;
    timestamp: number;
    transcript: TranscriptSegment[];
    speakerNames: Record<number, string>;
    duration: number;
    hasAudio: boolean;
    audioData?: string; // Base64 encoded audio data
    audioMimeType?: string; // MIME type of the audio
}

export interface MeetingModeProps {
    onClose: () => void;
    personality: any; // Using any for now to avoid circular deps
    llmConfig: LLMConfig;
    apiKey?: string;
    memories?: Memory[];
    speechConfig?: SpeechConfig;
}

export type RecognitionMode = 'off' | 'fast' | 'precise';

export type TranscriptionMode = 'off' | 'vosk' | 'whisper' | 'voxtral';
