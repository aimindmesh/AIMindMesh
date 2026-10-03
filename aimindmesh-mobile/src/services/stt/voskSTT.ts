import type { PluginListenerHandle } from '@capacitor/core';
import { logger } from '../logger';
import { Vosk } from 'vosk-capacitor';

/**
 * Vosk Speech-to-Text Service
 * Uses the vosk-capacitor plugin for offline speech recognition.
 */
export class VoskSpeechToTextService {
    private currentModelId: string | null = null;
    private isRecognizing: boolean = false;
    private listenerHandles: PluginListenerHandle[] = [];
    private startToken = 0;
    private context: string = 'unknown'; // Tracks which feature is using Vosk (meeting|voicechat)

    public isRecognitionActive(): boolean { return this.isRecognizing; }
    public getContext(): string { return this.context; }

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
     * Native Vosk records with its own AudioRecord, which fails without RECORD_AUDIO and
     * nothing else asks for it before a voice call.
     */
    private async ensureMicrophonePermission(): Promise<void> {
        const status = await Vosk.checkPermissions();
        if (status.microphone === 'granted') return;
        const requested = await Vosk.requestPermissions();
        if (requested.microphone !== 'granted') {
            throw new Error('Microphone permission denied. Please grant microphone access to use voice input.');
        }
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
        // stop() bumps the token: a start still awaiting the bridge must then undo itself,
        // otherwise the mic kept recording (and listeners kept firing) after hang-up
        const token = ++this.startToken;
        const handles: PluginListenerHandle[] = [];
        const isCurrent = () => token === this.startToken;
        const abandon = async () => {
            for (const handle of handles) {
                await handle.remove().catch(() => { /* already removed */ });
            }
        };
        // Per-session transcript: a late event from the previous session cannot leak in
        let accumulated = '';

        try {
            await this.ensureMicrophonePermission();
            if (!isCurrent()) return abandon();

            logger.log('info', '[VoskSTT] Setting up event listeners...');

            // Setup event listeners
            handles.push(await Vosk.addListener('partialResult', (result: { text: string }) => {
                if (result.text && isCurrent()) {
                    logger.log('info', `[VoskSTT] Partial result: ${result.text}`);
                    onUpdate((accumulated + ' ' + result.text).trim());
                }
            }));

            handles.push(await Vosk.addListener('finalResult', (result: { text: string }) => {
                if (result.text && isCurrent()) {
                    logger.log('info', `[VoskSTT] Final result: ${result.text}`);
                    accumulated = (accumulated + ' ' + result.text).trim();
                    onUpdate(accumulated);
                }
            }));

            // Listen for audio level (if implemented in plugin)
            if (onAudioLevel) {
                logger.log('info', '[VoskSTT] Setting up audio level listener');
                handles.push(await Vosk.addListener('audioLevel', (result: { level: number }) => {
                    if (isCurrent()) onAudioLevel(result.level);
                }));
            }

            handles.push(await Vosk.addListener('error', (error: { message: string }) => {
                logger.log('error', 'Vosk recognition error: ' + error.message);
            }));

            if (!isCurrent()) return abandon();
            this.listenerHandles = handles;

            logger.log('info', '[VoskSTT] Event listeners set up, calling Vosk.startRecognition()...');

            // Start recognition
            await Vosk.startRecognition();

            if (!isCurrent()) {
                // stop() ran before the native recorder existed, so its stopRecognition was a no-op
                await Vosk.stopRecognition().catch(() => { /* nothing to stop */ });
                return abandon();
            }

            logger.log('info', 'Vosk recognition started');
        } catch (error) {
            await abandon();
            if (isCurrent()) {
                this.isRecognizing = false;
                this.listenerHandles = [];
            }
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
        // Synchronously detach: a start() racing with this stop sees the new token and undoes
        // itself, and a new start() can begin without these handles being removed under it
        this.startToken++;
        this.isRecognizing = false;
        const handles = this.listenerHandles;
        this.listenerHandles = [];

        try {
            await Vosk.stopRecognition();
        } catch (error) {
            logger.log('error', 'Failed to stop Vosk recognition', error);
        }
        for (const handle of handles) {
            await handle.remove().catch(() => { /* already removed */ });
        }
        logger.log('info', 'Vosk recognition stopped');
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
