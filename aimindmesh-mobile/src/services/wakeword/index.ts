/**
 * Wake Word Service Module
 * Exports wake word detection functionality using OpenWakeWord
 */

export {
    WakeWordService,
    getWakeWordService,
    type WakeWordConfig,
    type WakeWordDetection,
    type WakeWordModelInfo,
    type WakeWordDetectedCallback,
    type ListeningStateCallback,
    type AudioLevelCallback,
    type ErrorCallback,
    type WakeWordDebugDiagnostics,
} from './wakeWordService';

/**
 * Pre-defined wake word models available from OpenWakeWord
 * Download from: https://github.com/dscripka/openWakeWord/releases
 */
export const WAKE_WORD_MODELS = {
    HEY_JARVIS: 'hey_jarvis_v0.1.tflite',
    ALEXA: 'alexa_v0.1.tflite',
    HEY_MYCROFT: 'hey_mycroft_v0.1.tflite',
    HEY_RHASSPY: 'hey_rhasspy_v0.1.tflite',
    TIMER: 'timer_v0.1.tflite',
    WEATHER: 'weather_v0.1.tflite',
} as const;

/**
 * Required base models for the OpenWakeWord pipeline
 */
export const BASE_MODELS = {
    MEL_SPECTROGRAM: 'melspectrogram.tflite',
    EMBEDDING: 'embedding_model.tflite',
} as const;

/**
 * Default configuration values
 */
export const DEFAULT_WAKE_WORD_CONFIG = {
    THRESHOLD: 0.5,
    COOLDOWN_MS: 2000,
    BUFFER_SIZE: 20,
} as const;

/**
 * Threshold presets for different use cases
 */
export const THRESHOLD_PRESETS = {
    /** More sensitive - may have more false positives */
    HIGH_SENSITIVITY: 0.35,
    /** Balanced sensitivity and accuracy */
    BALANCED: 0.5,
    /** Less sensitive - fewer false positives but may miss some activations */
    LOW_SENSITIVITY: 0.65,
    /** Very strict - minimal false positives */
    STRICT: 0.75,
} as const;