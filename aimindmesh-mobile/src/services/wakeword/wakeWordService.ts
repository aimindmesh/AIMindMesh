/**
 * Wake Word Service
 * TypeScript wrapper for the wakeword-capacitor native plugin.
 */

import { logger } from '../logger';
import {
    WakeWordDetection,
    WakeWordConfig,
    WakeWordDetectedCallback,
    ListeningStateCallback,
    AudioLevelCallback,
    ErrorCallback
} from './wakeword/wakeWordTypes';
import { WakeWordTraining } from './wakeword/wakeWordTraining';
import { WakeWordFiles } from './wakeword/wakeWordFiles';

// Re-export types
export * from './wakeword/wakeWordTypes';

let OpenWakeWord: any = null;
let pluginInitialized = false;

async function initializePlugin(): Promise<boolean> {
    if (pluginInitialized) return OpenWakeWord !== null;
    try {
        const module = await import('wakeword-capacitor');
        OpenWakeWord = module.OpenWakeWord;
        pluginInitialized = true;
        logger.log('info', 'OpenWakeWord plugin loaded successfully');
        return true;
    } catch (error) {
        logger.log('warn', 'OpenWakeWord plugin not available', error);
        pluginInitialized = true;
        return false;
    }
}

export class WakeWordService {
    private isModelLoaded = false;
    private isCurrentlyListening = false;
    private currentModelName: string | null = null;
    private initialized = false;

    // Sub-modules
    public training: WakeWordTraining;
    public files: WakeWordFiles;

    // Event listeners
    private detectionListeners: WakeWordDetectedCallback[] = [];
    private stateListeners: ListeningStateCallback[] = [];
    private levelListeners: AudioLevelCallback[] = [];
    private errorListeners: ErrorCallback[] = [];
    private pluginListeners: any[] = [];

    private config: WakeWordConfig = {
        modelName: 'hey_jarvis_v0.1.tflite',
        threshold: 0.5,
        cooldownMs: 2000,
        bufferSize: 20,
        debug: false,
    };

    constructor() {
        this.training = new WakeWordTraining(null);
        this.files = new WakeWordFiles(null);
        logger.log('info', 'WakeWordService initialized');
    }

    private async ensureInitialized(): Promise<boolean> {
        if (this.initialized) return OpenWakeWord !== null;
        const result = await initializePlugin();
        if (result) {
            this.training = new WakeWordTraining(OpenWakeWord);
            this.files = new WakeWordFiles(OpenWakeWord);
            await this.setupPluginListeners();
        }
        this.initialized = true;
        return result;
    }

    private async setupPluginListeners(): Promise<void> {
        if (!OpenWakeWord) return;
        try {
            this.pluginListeners.push(await OpenWakeWord.addListener('wakeWordDetected', (event: WakeWordDetection) => {
                logger.log('info', `Wake word detected: ${event.wakeWord} (confidence: ${event.confidence})`);
                this.detectionListeners.forEach(cb => cb(event));
            }));
            this.pluginListeners.push(await OpenWakeWord.addListener('listeningStateChanged', (event: { isListening: boolean }) => {
                this.isCurrentlyListening = event.isListening;
                this.stateListeners.forEach(cb => cb(event.isListening));
            }));
            this.pluginListeners.push(await OpenWakeWord.addListener('audioLevel', (event: { level: number }) => {
                this.levelListeners.forEach(cb => cb(event.level));
            }));
            this.pluginListeners.push(await OpenWakeWord.addListener('error', (event: { error: string; code: string }) => {
                logger.log('error', `Wake word error: ${event.error} (${event.code})`);
                this.errorListeners.forEach(cb => cb(event.error, event.code));
            }));
        } catch (error) {
            logger.log('error', 'Failed to setup plugin listeners', error);
        }
    }

    public async ensureAvailable(): Promise<boolean> {
        await this.ensureInitialized();
        return OpenWakeWord !== null;
    }

    public isAvailable(): boolean { return OpenWakeWord !== null; }

    public async loadModel(config: Partial<WakeWordConfig> = {}): Promise<boolean> {
        if (!(await this.ensureAvailable())) return false;
        this.config = { ...this.config, ...config };
        try {
            logger.log('info', `Loading wake word model: ${this.config.modelName}`);
            const result = await OpenWakeWord.loadModel({ ...this.config });
            this.isModelLoaded = result.loaded;
            this.currentModelName = result.modelName;
            return result.loaded;
        } catch (error) {
            logger.log('error', 'Failed to load wake word model', error);
            this.isModelLoaded = false;
            return false;
        }
    }

    public async unloadModel(): Promise<void> {
        if (!OpenWakeWord) return;
        try {
            await this.stopListening();
            await OpenWakeWord.unloadModel();
            this.isModelLoaded = false;
            this.currentModelName = null;
        } catch (error) { logger.log('error', 'Failed to unload model', error); }
    }

    public async startListening(): Promise<boolean> {
        if (!(await this.ensureAvailable()) || !this.isModelLoaded) return false;
        if (this.isCurrentlyListening) return true;
        try {
            const result = await OpenWakeWord.startListening({
                modelName: this.config.modelName,
                threshold: this.config.threshold,
                cooldownMs: this.config.cooldownMs,
                bufferSize: this.config.bufferSize
            });
            this.isCurrentlyListening = result.status === 'listening' || result.status === 'already_listening';
            return this.isCurrentlyListening;
        } catch (error) {
            logger.log('error', 'Failed to start listening', error);
            return false;
        }
    }

    public async stopListening(): Promise<void> {
        if (!OpenWakeWord || !this.isCurrentlyListening) return;
        try {
            await OpenWakeWord.stopListening();
            this.isCurrentlyListening = false;
        } catch (error) { logger.log('error', 'Failed to stop listening', error); }
    }

    public async checkListening(): Promise<boolean> {
        if (!OpenWakeWord) return false;
        try {
            const result = await OpenWakeWord.isListening();
            this.isCurrentlyListening = result.listening;
            return result.listening;
        } catch { return false; }
    }

    public isListening(): boolean { return this.isCurrentlyListening; }

    // Delegates to sub-modules for backward compatibility
    public async startTraining() { await this.training.startTraining(); }
    public async stopTraining() { await this.training.stopTraining(); }
    public async saveProfile(name: string) { await this.training.saveProfile(name); }
    public async clearTrainingData() { await this.training.clearTrainingData(); }
    public async getTrainingAudio() { return await this.training.getTrainingAudio(); }
    public async provideTrainingSample(base64: string) { return await this.training.provideTrainingSample(base64); }
    public async getDebugDiagnostics() { return await this.training.getDebugDiagnostics(); }

    public async getAvailableModels() { return await this.files.getAvailableModels(); }
    public async checkBaseModels() { return await this.files.checkBaseModels(); }
    public async copyModelFile(source: string, file: string) { return await this.files.copyModelFile(source, file); }
    public async importModelZip(uri: string, file?: string) { return await this.files.importModelZip(uri, file); }
    public async deleteModel(name: string) {
        await this.files.deleteModel(name);
        if (this.currentModelName === name) { this.isModelLoaded = false; this.currentModelName = null; }
    }

    public async setThreshold(t: number) {
        this.config.threshold = t;
        if (OpenWakeWord && this.isModelLoaded) await OpenWakeWord.setThreshold({ threshold: t });
    }

    public async setCooldown(c: number) {
        this.config.cooldownMs = c;
        if (OpenWakeWord && this.isModelLoaded) await OpenWakeWord.setCooldown({ cooldownMs: c });
    }

    public async setBufferSize(b: number) {
        this.config.bufferSize = b;
        if (OpenWakeWord && this.isModelLoaded) await OpenWakeWord.setBufferSize({ bufferSize: b });
    }

    public getConfig(): WakeWordConfig { return { ...this.config }; }
    public getCurrentModel(): string | null { return this.currentModelName; }

    public onDetection(cb: WakeWordDetectedCallback) {
        this.detectionListeners.push(cb);
        return () => { this.detectionListeners = this.detectionListeners.filter(l => l !== cb); };
    }

    public onStateChange(cb: ListeningStateCallback) {
        this.stateListeners.push(cb);
        return () => { this.stateListeners = this.stateListeners.filter(l => l !== cb); };
    }

    public onAudioLevel(cb: AudioLevelCallback) {
        this.levelListeners.push(cb);
        return () => { this.levelListeners = this.levelListeners.filter(l => l !== cb); };
    }

    public onError(cb: ErrorCallback) {
        this.errorListeners.push(cb);
        return () => { this.errorListeners = this.errorListeners.filter(l => l !== cb); };
    }

    public async destroy(): Promise<void> {
        await this.stopListening();
        await this.unloadModel();
        for (const l of this.pluginListeners) { try { await l.remove(); } catch (e) { } }
        this.pluginListeners = [];
        this.detectionListeners = [];
        this.stateListeners = [];
        this.levelListeners = [];
        this.errorListeners = [];
        logger.log('info', 'WakeWordService destroyed');
    }
}

let _wakeWordService: WakeWordService | null = null;
export function getWakeWordService(): WakeWordService {
    if (!_wakeWordService) _wakeWordService = new WakeWordService();
    return _wakeWordService;
}