import { SD, SDGenerateOptions, SDGenerateResult, SDProgressEvent, SDCapabilities } from 'sd-capacitor';
import { logger } from '../logger';
import { FileSystemAdapter as Filesystem, Directory } from '../../utils/fileSystemAdapter';

export interface ImageGenerationRequest {
    prompt: string;
    negativePrompt?: string;
    sourceImage?: string; // Base64 or local file path for image-to-image editing
    strength?: number;    // Denoising strength (0.1 - 0.9)
    steps?: number;
    cfgScale?: number;
    seed?: number;
    width?: number;
    height?: number;
    onProgress?: (event: SDProgressEvent) => void;
}

export class ImageGenService {
    private static instance: ImageGenService;
    private isLoaded = false;
    private currentModelPath: string | null = null;

    private constructor() {
        logger.log('info', '[ImageGenService] Initialized Stable Diffusion NPU Service');
    }

    public static getInstance(): ImageGenService {
        if (!ImageGenService.instance) {
            ImageGenService.instance = new ImageGenService();
        }
        return ImageGenService.instance;
    }

    public getIsLoaded(): boolean {
        return this.isLoaded;
    }

    public getCurrentModelPath(): string | null {
        return this.currentModelPath;
    }

    /**
     * Check device hardware acceleration capabilities (Hexagon NPU v79 / v75)
     */
    public async getCapabilities(): Promise<SDCapabilities> {
        try {
            return await SD.getCapabilities();
        } catch (e) {
            logger.log('warn', '[ImageGenService] Failed to check NPU capabilities', e);
            return {
                hasNpu: false,
                supportedBackends: ['cpu'],
                socModel: 'Unknown'
            };
        }
    }

    /**
     * Load Qualcomm QNN Stable Diffusion model bundle
     */
    public async loadModel(modelPath: string): Promise<boolean> {
        try {
            let absolutePath = modelPath.trim();
            if (absolutePath.startsWith('file://')) {
                absolutePath = absolutePath.replace(/^file:\/\//, '');
            }

            if (!absolutePath.startsWith('/')) {
                const uriResult = await Filesystem.getUri({ path: absolutePath, directory: Directory.Data });
                absolutePath = uriResult.uri.replace(/^file:\/\//, '');
            }

            if (this.isLoaded && this.currentModelPath === absolutePath) {
                return true;
            }

            logger.log('info', `[ImageGenService] Loading SD model onto Qualcomm NPU: ${absolutePath}`);
            const result = await SD.loadModel({ modelPath: absolutePath, backend: 'npu' });

            if (result.success) {
                this.isLoaded = true;
                this.currentModelPath = absolutePath;
                logger.log('info', '[ImageGenService] SD model loaded on NPU successfully');
                return true;
            } else {
                logger.log('error', `[ImageGenService] Failed to load SD model: ${result.error || 'Unknown native error'}`);
                return false;
            }
        } catch (e) {
            logger.log('error', '[ImageGenService] Exception loading model', e);
            return false;
        }
    }

    /**
     * Generate or modify an image on-device using Qualcomm Hexagon NPU
     */
    public async generateImage(req: ImageGenerationRequest): Promise<SDGenerateResult> {
        // Verify model is loaded or auto-load active local model
        const status = await SD.isLoaded().catch(() => ({ loaded: false }));
        if (!status.loaded) {
            const { listLocalSDModels, getSDModelPath } = await import('./sdModelDownloader');
            const localModels = await listLocalSDModels();

            // 1. Try configured model from settings
            let targetPath: string | null = null;
            let targetModelId: string | null = null;

            try {
                const rawSettings = localStorage.getItem('settings');
                if (rawSettings) {
                    const parsed = JSON.parse(rawSettings);
                    if (parsed?.llmConfig?.sdModelId) {
                        targetModelId = parsed.llmConfig.sdModelId;
                    }
                    if (parsed?.llmConfig?.sdModelPath) {
                        targetPath = parsed.llmConfig.sdModelPath;
                    }
                }
            } catch (e) {
                // ignore
            }

            if (targetModelId && !targetPath) {
                targetPath = await getSDModelPath(targetModelId);
            }

            // 2. Fallback to first installed model if configured model not found
            if (!targetPath && localModels.length > 0) {
                const fallbackId = (targetModelId && localModels.includes(targetModelId)) ? targetModelId : localModels[0];
                targetPath = await getSDModelPath(fallbackId);
                targetModelId = fallbackId;
            }

            if (targetPath) {
                const loaded = await this.loadModel(targetPath);
                if (!loaded) {
                    throw new Error(`Failed to load Stable Diffusion model (${targetModelId || targetPath}). Please check Settings > Vision & Image Creation.`);
                }
            } else if (localModels.length > 0) {
                throw new Error('No Stable Diffusion model selected. Please select a model in Settings > Vision & Image Creation.');
            } else {
                throw new Error('No Stable Diffusion model installed. Please import a model (.zip) in Settings > Vision & Image Creation.');
            }
        }

        let listenerHandle: any = null;
        try {
            if (req.onProgress) {
                listenerHandle = await SD.addListener('sdProgress', (event: SDProgressEvent) => {
                    req.onProgress?.(event);
                });
            }

            const options: SDGenerateOptions = {
                prompt: req.prompt,
                negativePrompt: req.negativePrompt ?? '',
                sourceImage: req.sourceImage,
                strength: req.strength ?? 0.65,
                steps: req.steps || 25,
                cfgScale: req.cfgScale || 7.5,
                seed: req.seed ?? -1,
                width: req.width || 512,
                height: req.height || 512,
            };

            const modeDesc = req.sourceImage ? 'Image-to-Image Edit' : 'Text-to-Image';
            logger.log('info', `[ImageGenService] Starting NPU ${modeDesc}: "${req.prompt}" | Neg: "${options.negativePrompt}"`);
            const result = await SD.generateImage(options);
            logger.log('info', `[ImageGenService] Generation completed in ${result.generationTimeMs}ms`);
            return result;
        } finally {
            if (listenerHandle) {
                listenerHandle.remove();
            }
        }
    }

    /**
     * Unload SD model from NPU memory
     */
    public async unloadModel(): Promise<void> {
        try {
            await SD.unloadModel();
            this.isLoaded = false;
            this.currentModelPath = null;
            logger.log('info', '[ImageGenService] SD NPU model unloaded');
        } catch (e) {
            logger.log('warn', '[ImageGenService] Error unloading SD model', e);
        }
    }
}

export const imageGenService = ImageGenService.getInstance();

