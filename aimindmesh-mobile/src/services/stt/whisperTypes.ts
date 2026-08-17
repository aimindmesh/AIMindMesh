/**
 * Whisper STT Types and Profiles
 */

export interface WhisperSegment {
    text: string;
    startMs: number;
    endMs: number;
    /** Segment-level confidence (0-1) */
    confidence?: number;
}

export interface WhisperTranscriptResult {
    text: string;
    segments: WhisperSegment[];
    processingTimeMs?: number;
    /** Word-level timestamps (when wordTimestamps=true) */
    words?: Array<{
        word?: string;
        text?: string;
        startMs?: number;
        start_ms?: number;
        endMs?: number;
        end_ms?: number;
        confidence?: number;
        probability?: number;
    }>;
}

export interface WhisperConfig {
    language?: string;  // 'auto', 'en', 'it', etc.
    translate?: boolean; // Translate to English
    temperature?: number;     // 0.0 = deterministic decoding
    beamSize?: number;        // 5 = standard beam search, 1 = greedy
    bestOf?: number;          // Number of candidates
    initialPrompt?: string;   // Context prompt
    vadFilter?: boolean;      // Enable silence filtering
    minSilenceDurationMs?: number; // Silence threshold for splitting
    speechPadMs?: number;     // Padding around speech segments
    conditionOnPreviousText?: boolean; // Use previous context
    wordTimestamps?: boolean; // Enable word-level timestamps
    chunkSize?: number;       // Chunk size in seconds for streaming
}

export interface WhisperDeviceInfo {
    soc: 'SNAPDRAGON_8_ELITE' | 'SNAPDRAGON_8_GEN_3' | 'SNAPDRAGON_8_GEN_2' | 'UNKNOWN';
    availableCores: number;
    recommendedThreads: number;
    recommendedModel: string;
    hasNpu?: boolean;
    npuArch?: string;
    recommendedBackend?: 'npu' | 'cpu';
    deviceInfo: string;
}

export interface WhisperStreamingSegment {
    text: string;
    startMs: number;
    endMs: number;
    segmentIndex: number;
}

export const whisperProfiles = {
    // Fast preview for real-time/hybrid/whisper-only mode (greedy decoding)
    fastPreview: {
        temperature: 0.0,
        beamSize: 1,
        bestOf: 1,
        vadFilter: false,
        conditionOnPreviousText: false,
        wordTimestamps: false
    } as WhisperConfig,

    // Maximum accuracy for post-processing
    maxAccuracy: {
        temperature: 0.0,
        beamSize: 5,
        bestOf: 5,
        vadFilter: true,
        minSilenceDurationMs: 1000,
        speechPadMs: 400,
        conditionOnPreviousText: true,
        wordTimestamps: true
    } as WhisperConfig,

    italianPrompts: {
        fastPreview: 'Trascrizione in italiano.',
        maxAccuracy: 'Trascrizione professionale in italiano. Meeting di progetto con terminologia tecnica: task, issue, milestone, deploy, sprint, backlog.'
    }
};
