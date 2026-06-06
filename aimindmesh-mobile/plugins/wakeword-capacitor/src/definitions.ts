import type { PluginListenerHandle } from '@capacitor/core';

/**
 * OpenWakeWord Plugin Interface
 * 
 * Provides wake word detection using OpenWakeWord models with TensorFlow Lite.
 * Pipeline: Audio PCM → melspectrogram.tflite → embedding_model.tflite → wake_word.tflite
 */
export interface OpenWakeWordPlugin {
  /**
   * Load wake word models (melspectrogram, embedding, and wake word model)
   * @param options Model configuration
   */
  loadModel(options: LoadModelOptions): Promise<LoadModelResult>;

  /**
   * Unload all models and free resources
   */
  unloadModel(): Promise<void>;

  /**
   * Check if models are loaded and ready
   */
  isModelLoaded(): Promise<{ loaded: boolean }>;

  /**
   * Start listening for wake word
   * Requires RECORD_AUDIO permission
   */
  startListening(): Promise<{ status: string }>;

  /**
   * Stop listening for wake word
   */
  stopListening(): Promise<void>;

  /**
   * Check if currently listening
   */
  isListening(): Promise<{ listening: boolean }>;

  /**
   * Set detection threshold
   * @param options Threshold value (0.0 - 1.0)
   * Lower = more sensitive (more false positives)
   * Higher = less sensitive (more false negatives)
   */
  setThreshold(options: { threshold: number }): Promise<{ threshold: number }>;

  /**
   * Set cooldown period between detections
   * Prevents multiple triggers for the same utterance
   * @param options Cooldown in milliseconds
   */
  setCooldown(options: { cooldownMs: number }): Promise<{ cooldownMs: number }>;

  /**
   * Set audio buffer size (affects responsiveness vs stability)
   * @param options Number of audio chunks to buffer
   * Lower = more responsive but less stable
   * Higher = more stable but higher latency
   */
  setBufferSize(options: { bufferSize: number }): Promise<{ bufferSize: number }>;

  /**
   * Get list of available pre-trained models
   */
  getAvailableModels(): Promise<{ models: WakeWordModelInfo[] }>;

  /**
   * Copy a model file from a source path to the models directory
   * Used for importing custom models
   */
  copyModelFile(options: { sourcePath: string; fileName: string }): Promise<{ path: string }>;

  /**
   * Check if base models (melspectrogram and embedding) are present
   */
  checkBaseModels(): Promise<{
    hasMelSpectrogram: boolean;
    hasEmbedding: boolean;
    melSpectrogramPath?: string;
    embeddingPath?: string;
  }>;

  /**
   * Listen for wake word detection events
   */
  addListener(
    eventName: 'wakeWordDetected',
    callback: (event: WakeWordDetectedEvent) => void
  ): Promise<PluginListenerHandle>;

  /**
   * Listen for listening state changes
   */
  addListener(
    eventName: 'listeningStateChanged',
    callback: (event: ListeningStateChangedEvent) => void
  ): Promise<PluginListenerHandle>;

  /**
   * Listen for errors
   */
  addListener(
    eventName: 'error',
    callback: (event: WakeWordErrorEvent) => void
  ): Promise<PluginListenerHandle>;

  /**
   * Listen for audio level updates (for UI visualization)
   */
  addListener(
    eventName: 'audioLevel',
    callback: (event: AudioLevelEvent) => void
  ): Promise<PluginListenerHandle>;

  /**
   * Remove all listeners
   */
  removeAllListeners(): Promise<void>;

  /**
   * Start training mode (collecting samples)
   */
  startTraining(): Promise<void>;

  /**
   * Stop training mode
   */
  stopTraining(): Promise<void>;

  /**
   * Save the collected samples as a custom wake word profile
   * @param options Profile name
   */
  saveProfile(options: { name: string }): Promise<void>;

  /**
   * Delete a wake word model
   * @param options Model name
   */
  deleteModel(options: { modelName: string }): Promise<void>;
  /**
   * Get debug diagnostics for custom wake word models
   * Returns internal state including template matching stats
   */
  getDebugDiagnostics(): Promise<any>;
}

/**
 * Options for loading wake word models
 */
export interface LoadModelOptions {
  /** 
   * Wake word model filename (e.g., 'hey_jarvis_v0.1.tflite')
   * Should be located in the wakeword-models directory
   */
  modelName: string;

  /** 
   * Detection threshold (0.0 - 1.0)
   * @default 0.5
   * Recommended: 0.3-0.4 for more sensitivity, 0.6-0.7 for fewer false positives
   */
  threshold?: number;

  /** 
   * Cooldown between detections in milliseconds
   * @default 2000
   * Prevents repeated triggers for the same utterance
   */
  cooldownMs?: number;

  /** 
   * Audio buffer size in chunks (each chunk is 80ms)
   * @default 20
   * 10 = more reactive, 30 = more stable
   */
  bufferSize?: number;

  /** 
   * Enable debug logging
   * @default false
   */
  debug?: boolean;
}

/**
 * Result of model loading
 */
export interface LoadModelResult {
  /** Whether models were loaded successfully */
  loaded: boolean;
  /** Name of the loaded wake word model */
  modelName: string;
  /** Average inference time per frame in milliseconds */
  inferenceTimeMs?: number;
}

/**
 * Wake word detection event
 */
export interface WakeWordDetectedEvent {
  /** Name of the detected wake word model */
  wakeWord: string;
  /** Confidence score (0.0 - 1.0) */
  confidence: number;
  /** Detection timestamp (Unix milliseconds) */
  timestamp: number;
}

/**
 * Listening state change event
 */
export interface ListeningStateChangedEvent {
  /** Whether currently listening */
  isListening: boolean;
}

/**
 * Error event
 */
export interface WakeWordErrorEvent {
  /** Error message */
  error: string;
  /** Error code */
  code: 'AUDIO_ERROR' | 'MODEL_ERROR' | 'PERMISSION_ERROR' | 'UNKNOWN_ERROR';
}

/**
 * Audio level event for UI visualization
 */
export interface AudioLevelEvent {
  /** RMS audio level (0.0 - 1.0) */
  level: number;
}

/**
 * Information about an available wake word model
 */
export interface WakeWordModelInfo {
  /** Model filename */
  name: string;
  /** Human-readable display name */
  displayName: string;
  /** Model description */
  description: string;
  /** Whether the model file exists locally */
  isDownloaded: boolean;
  /** File size in bytes (if downloaded) */
  fileSize?: number;
  /** Full path to the model file (if downloaded) */
  path?: string;
}

/**
 * Pre-defined wake word models available from OpenWakeWord
 * These can be downloaded from: https://github.com/dscripka/openWakeWord/releases
 */
export const AVAILABLE_WAKE_WORD_MODELS = {
  HEY_JARVIS: 'hey_jarvis_v0.1.tflite',
  ALEXA: 'alexa_v0.1.tflite',
  HEY_MYCROFT: 'hey_mycroft_v0.1.tflite',
  HEY_RHASSPY: 'hey_rhasspy_v0.1.tflite',
  TIMER: 'timer_v0.1.tflite',
  WEATHER: 'weather_v0.1.tflite',
} as const;

/**
 * Required base models for the OpenWakeWord pipeline
 * These must be present for any wake word model to work
 */
export const REQUIRED_BASE_MODELS = {
  MEL_SPECTROGRAM: 'melspectrogram.tflite',
  EMBEDDING: 'embedding_model.tflite',
} as const;

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG = {
  THRESHOLD: 0.5,
  COOLDOWN_MS: 2000,
  BUFFER_SIZE: 20,
  SAMPLE_RATE: 16000,
  CHUNK_SIZE_MS: 80,
} as const;