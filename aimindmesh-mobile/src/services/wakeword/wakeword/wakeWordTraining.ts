import { logger } from '../../logger';
import { WakeWordDebugDiagnostics } from './wakeWordTypes';

/**
 * Training API wrapper for the OpenWakeWord plugin
 */
export class WakeWordTraining {
    constructor(private plugin: any) { }

    /**
     * Start training mode
     */
    public async startTraining(): Promise<void> {
        if (!this.plugin) throw new Error('Plugin not available');
        await this.plugin.startTraining();
    }

    /**
     * Stop training mode
     */
    public async stopTraining(): Promise<void> {
        if (!this.plugin) return;
        await this.plugin.stopTraining();
    }

    /**
     * Save custom profile
     */
    public async saveProfile(name: string): Promise<void> {
        if (!this.plugin) throw new Error('Plugin not available');
        await this.plugin.saveProfile({ name });
    }

    /**
     * Clear training data (samples and audio)
     */
    public async clearTrainingData(): Promise<void> {
        if (!this.plugin) return;
        await this.plugin.clearTrainingData();
    }

    /**
     * Get training audio from native layer (Base64 PCM16 @ 16kHz)
     */
    public async getTrainingAudio(): Promise<string | null> {
        if (!this.plugin) return null;
        try {
            const result = await this.plugin.getTrainingAudio();
            return result.audioBase64 || null;
        } catch (error) {
            logger.log('warn', 'Failed to get training audio', error);
            return null;
        }
    }

    /**
     * Provide a training sample from JS-side high-quality recording
     */
    public async provideTrainingSample(base64Pcm: string): Promise<boolean> {
        if (!this.plugin) {
            logger.log('error', 'Plugin not available for training sample');
            return false;
        }

        try {
            const result = await this.plugin.provideTrainingSample({ sample: base64Pcm });
            return result.success;
        } catch (error) {
            logger.log('warn', 'Failed to provide training sample', error);
            return false;
        }
    }

    /**
     * Get debug diagnostics for analyzing custom wake word detection
     */
    public async getDebugDiagnostics(): Promise<WakeWordDebugDiagnostics> {
        if (!this.plugin) {
            return { available: false, error: 'Plugin not available' };
        }

        try {
            const result = await this.plugin.getDebugDiagnostics();
            return result as WakeWordDebugDiagnostics;
        } catch (error) {
            logger.log('warn', 'Failed to get debug diagnostics', error);
            return { available: false, error: String(error) };
        }
    }
}
