import { logger } from '../logger';
import { Vosk } from 'vosk-capacitor';

/**
 * Vosk Speech-to-Text Service
 * Uses the vosk-capacitor plugin for offline speech recognition.
 */
export class VoskSpeechToTextService {
    private currentModelId: string | null = null;
    private isRecognizing: boolean = false;
    private listenerHandles: any[] = [];
    private accumulatedTranscript: string = '';

    constructor() {
        logger.log('info', 'Vosk STT Service initialized');
    }

    /**
     * Check if Vosk is supported (always true on Android with plugin installed)
     */
    public isSupported(): boolean {
        return true; // Plugin is installed
    }

    /**
     * Load a Vosk model by ID
     * @param modelId The ID of the model to load (e.g., 'vosk-model-en-us-0.22-lgraph')
     */
    public async loadModel(modelId: string): Promise<void> {
        logger.log('info', `Loading Vosk model: ${modelId}`);

        try {
            // Unload current model if any
            if (this.currentModelId) {
                await this.unloadModel();
            }

            // Load model - path is relative to app data directory
            const modelPath = `vosk-models/${modelId}`;
            await Vosk.loadModel({ modelPath });

            this.currentModelId = modelId;
            logger.log('info', `Vosk model loaded: ${modelId}`);
        } catch (error) {
            logger.log('error', 'Failed to load Vosk model', error);
            throw error;
        }
    }

    /**
     * Unload the current model
     */
    public async unloadModel(): Promise<void> {
        if (!this.currentModelId) {
            return;
        }

        logger.log('info', 'Unloading Vosk model');

        try {
            // Stop recognition if running
            if (this.isRecognizing) {
                await this.stop();
            }

            await Vosk.unloadModel();
            this.currentModelId = null;
            logger.log('info', 'Vosk model unloaded');
        } catch (error) {
            logger.log('error', 'Failed to unload Vosk model', error);
        }
    }

    /**
     * Check if a model is currently loaded
     */
    public isModelLoaded(): boolean {
        return this.currentModelId !== null;
    }

    /**
     * Get the currently loaded model ID
     */
    public getCurrentModelId(): string | null {
        return this.currentModelId;
    }

    /**
     * Start speech recognition
     * @param onUpdate Callback that receives the full transcript
     * @param _apiKey Optional API key (ignored)
     * @param onAudioLevel Optional callback for audio level (0-1)
     */
    public async start(onUpdate: (transcript: string) => void, _apiKey?: string, onAudioLevel?: (level: number) => void): Promise<void> {
        logger.log('info', `[VoskSTT] start() called. Model loaded: ${this.currentModelId}, isRecognizing: ${this.isRecognizing}`);

        if (!this.currentModelId) {
            logger.log('error', '[VoskSTT] No model loaded, throwing error');
            throw new Error('No Vosk model loaded. Call loadModel() first.');
        }

        if (this.isRecognizing) {
            logger.log('warn', 'Vosk recognition already running');
            return;
        }

        logger.log('info', 'Starting Vosk recognition');
        this.isRecognizing = true;

        try {
            logger.log('info', '[VoskSTT] Setting up event listeners...');

            // Setup event listeners
            const partialHandle = await Vosk.addListener('partialResult', (result: { text: string }) => {
                if (result.text) {
                    logger.log('info', `[VoskSTT] Partial result: ${result.text}`);
                    onUpdate((this.accumulatedTranscript + ' ' + result.text).trim());
                }
            });

            const finalHandle = await Vosk.addListener('finalResult', (result: { text: string }) => {
                if (result.text) {
                    logger.log('info', `[VoskSTT] Final result: ${result.text}`);
                    this.accumulatedTranscript = (this.accumulatedTranscript + ' ' + result.text).trim();
                    onUpdate(this.accumulatedTranscript);
                }
            });

            // Listen for audio level (if implemented in plugin)
            let audioLevelHandle: any = null;
            if (onAudioLevel) {
                logger.log('info', '[VoskSTT] Setting up audio level listener');
                audioLevelHandle = await Vosk.addListener('audioLevel' as any, ((result: { level: number }) => {
                    onAudioLevel(result.level);
                }) as any);
            }

            const errorHandle = await Vosk.addListener('error', (error: { message: string }) => {
                logger.log('error', 'Vosk recognition error: ' + error.message);
            });

            this.listenerHandles = [partialHandle, finalHandle, errorHandle];
            if (audioLevelHandle) {
                this.listenerHandles.push(audioLevelHandle);
            }

            logger.log('info', '[VoskSTT] Event listeners set up, calling Vosk.startRecognition()...');

            // Start recognition
            await Vosk.startRecognition();

            logger.log('info', 'Vosk recognition started');
        } catch (error) {
            this.isRecognizing = false;
            logger.log('error', 'Failed to start Vosk recognition', error);
            throw error;
        }
    }

    /**
     * Stop speech recognition
     */
    public async stop(): Promise<void> {
        if (!this.isRecognizing) {
            return;
        }

        logger.log('info', 'Stopping Vosk recognition');

        try {
            await Vosk.stopRecognition();

            // Remove event listeners
            for (const handle of this.listenerHandles) {
                await handle.remove();
            }
            this.listenerHandles = [];

            this.isRecognizing = false;

            // CRITICAL: Clear accumulated transcript to prevent contamination
            this.accumulatedTranscript = '';

            logger.log('info', 'Vosk recognition stopped');
        } catch (error) {
            logger.log('error', 'Failed to stop Vosk recognition', error);
        }
    }

    /**
     * Check if recognition is currently running
     */
    public isRunning(): boolean {
        return this.isRecognizing;
    }
}

// Singleton instance
let _voskService: VoskSpeechToTextService | null = null;

/**
 * Get the singleton Vosk STT service instance
 */
export const getVoskSttService = (): VoskSpeechToTextService => {
    if (!_voskService) {
        _voskService = new VoskSpeechToTextService();
    }
    return _voskService;
};
