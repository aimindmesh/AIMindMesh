import { Kokoro } from './kokoroPlugin';

/**
 * Check if the Kokoro multi-language bundle is downloaded and extracted
 */
export const checkKokoroStatus = async (): Promise<boolean> => {
    try {
        const result = await Kokoro.isModelReady();
        return result.ready;
    } catch (e) {
        return false;
    }
};

/**
 * Initiates the native download process
 */
export const downloadKokoroModel = async (): Promise<void> => {
    return Kokoro.downloadModel();
};

/**
 * Imports a model from a local path
 */
export const importKokoroModel = async (path: string): Promise<void> => {
    return Kokoro.importModel({ path });
};
