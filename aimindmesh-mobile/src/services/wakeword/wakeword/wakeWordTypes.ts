/**
 * Wake Word Detection Types
 */
export interface WakeWordDetection {
    wakeWord: string;
    confidence: number;
    timestamp: number;
}

/**
 * Wake word service configuration
 */
export interface WakeWordConfig {
    /** Model filename (e.g., 'hey_jarvis_v0.1.tflite') */
    modelName: string;
    /** Detection threshold (0.0 - 1.0), default 0.5 */
    threshold?: number;
    /** Cooldown between detections in ms, default 2000 */
    cooldownMs?: number;
    /** Buffer size in chunks, default 20 */
    bufferSize?: number;
    /** Enable debug logging */
    debug?: boolean;
    /** Required consecutive high-confidence frames for custom models (default 8) */
    consecutiveFrames?: number;
}

/**
 * Model information
 */
export interface WakeWordModelInfo {
    name: string;
    displayName: string;
    description: string;
    isDownloaded: boolean;
    fileSize?: number;
    path?: string;
}

/**
 * Callback types
 */
export type WakeWordDetectedCallback = (detection: WakeWordDetection) => void;
export type ListeningStateCallback = (isListening: boolean) => void;
export type AudioLevelCallback = (level: number) => void;
export type ErrorCallback = (error: string, code: string) => void;

/**
 * Debug diagnostics result for analyzing custom wake word detection
 */
export interface WakeWordDebugDiagnostics {
    available: boolean;
    error?: string;
    templateMagnitude?: number;
    templateDimension?: number;
    templateFirst10?: number[];
    lastEmbeddingMagnitude?: number;
    lastEmbeddingFirst10?: number[];
    lastChunkSize?: number;
    lastRms?: number;
    similarity?: number;
    threshold?: number;
    vadProbability?: number;
    bufferSize?: number;
    isMatch?: boolean;
    enrollmentSampleCount?: number;
    consecutiveDetections?: number;
    minConsecutiveFrames?: number;
    debugInfo?: string;
}
