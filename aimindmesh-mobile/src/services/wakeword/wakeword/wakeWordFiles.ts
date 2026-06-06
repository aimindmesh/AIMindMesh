import { logger } from '../../logger';
import { WakeWordModelInfo } from './wakeWordTypes';

/**
 * File management logic for wake word models
 */
export class WakeWordFiles {
    constructor(private plugin: any) { }

    /**
     * Get available wake word models
     */
    public async getAvailableModels(): Promise<WakeWordModelInfo[]> {
        if (!this.plugin) return [];

        try {
            const result = await this.plugin.getAvailableModels();
            return result.models || [];
        } catch (error) {
            logger.log('error', 'Failed to get available models', error);
            return [];
        }
    }

    /**
     * Check if base models are present
     */
    public async checkBaseModels(): Promise<{ hasMelSpectrogram: boolean; hasEmbedding: boolean }> {
        if (!this.plugin) {
            return { hasMelSpectrogram: false, hasEmbedding: false };
        }

        try {
            return await this.plugin.checkBaseModels();
        } catch (error) {
            logger.log('error', 'Failed to check base models', error);
            return { hasMelSpectrogram: false, hasEmbedding: false };
        }
    }

    /**
     * Copy a model file to the models directory
     */
    public async copyModelFile(sourcePath: string, fileName: string): Promise<string | null> {
        if (!this.plugin) return null;

        try {
            const result = await this.plugin.copyModelFile({ sourcePath, fileName });
            return result.path;
        } catch (error) {
            logger.log('error', 'Failed to copy model file', error);
            return null;
        }
    }

    /**
     * Import a model from a ZIP file
     */
    public async importModelZip(uri: string, fileName?: string): Promise<string | null> {
        if (!this.plugin) return null;

        try {
            let targetFileName = fileName || uri.split('/').pop() || `imported_model_${Date.now()}.zip`;

            const result = await this.plugin.importModelZip({
                sourcePath: uri,
                fileName: targetFileName
            });

            logger.log('info', `Model imported to: ${result.path}`);
            return result.path;
        } catch (error) {
            logger.log('error', 'Failed to import model zip', error);
            throw error;
        }
    }

    /**
     * Delete a model
     */
    public async deleteModel(modelName: string): Promise<void> {
        if (!this.plugin) throw new Error('Plugin not available');
        await this.plugin.deleteModel({ modelName });
    }
}
