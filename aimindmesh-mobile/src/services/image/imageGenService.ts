import { SD, SDGenerateOptions, SDGenerateResult, SDProgressEvent, SDCapabilities, SDModelInfo, SDSampler } from 'sd-capacitor';
import { logger } from '../logger';
import { FileSystemAdapter as Filesystem, Directory } from '../../utils/fileSystemAdapter';
import { readSetting } from '../security/secretStore';
import { ensureResident, enterActivity, leaveActivity, markUnloaded } from '../model/modelOrchestrator';
import { DEFAULT_NEGATIVE_PROMPT } from './imagePrompt';

export interface ImageGenerationRequest {
    prompt: string;
    negativePrompt?: string;
    sourceImage?: string; // Data URL, base64 or file path of the image to edit (img2img)
    strength?: number;    // Share of the steps re-run on the source (0.1 subtle - 0.95 drastic)
    steps?: number;
    cfgScale?: number;
    seed?: number;
    width?: number;
    height?: number;
    aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
    upscale?: 1 | 2 | 4;
    sampler?: SDSampler;
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

    /** Native truth (the JS flag is lost when the WebView reloads) */
    public async isModelLoaded(): Promise<boolean> {
        try {
            return (await SD.isLoaded()).loaded;
        } catch {
            return this.isLoaded;
        }
    }

    /** What the loaded package supports (editing, AI upscaling), null when none is loaded */
    public async getModelInfo(): Promise<SDModelInfo | null> {
        try {
            const state = await SD.isLoaded();
            return state.loaded ? state : null;
        } catch {
            return null;
        }
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

            // Stable Diffusion never shares the RAM with an LLM or a large speech model
            await ensureResident('sd');
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
     * Loads the Stable Diffusion model chosen in Settings (or the first installed one) if no
     * model is loaded yet. Image generation calls it; the image screen calls it when it opens.
     */
    public async ensureLoaded(): Promise<void> {
        if (await this.isModelLoaded()) return;
        const { listLocalSDModels, getSDModelPath } = await import('./sdModelDownloader');
        const localModels = await listLocalSDModels();

        // 1. The model chosen in Settings > Vision (stored in llm-config)
        const llmConfig = readSetting<{ sdModelId?: string; sdModelPath?: string } | null>('llm-config', null);
        let targetModelId: string | null = llmConfig?.sdModelId ?? null;
        let targetPath: string | null = llmConfig?.sdModelPath ?? null;
        if (targetModelId && !targetPath) {
            targetPath = await getSDModelPath(targetModelId);
        }

        // 2. Fallback to the first installed model if the configured one is not found
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
        } else {
            throw new Error('No Stable Diffusion model installed. Please import a model (.zip) in Settings > Vision & Image Creation.');
        }
    }

    /**
     * Generate or modify an image on-device using Qualcomm Hexagon NPU
     */
    public async generateImage(req: ImageGenerationRequest): Promise<SDGenerateResult> {
        // Verify model is loaded or auto-load the configured local model
        await this.ensureLoaded();

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
                aspectRatio: req.aspectRatio || '1:1',
                upscale: req.upscale || 1,
                sampler: req.sampler || 'euler',
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
     * Settings: checks that a bundle loads on the NPU without leaving it in RAM (the image
     * screen loads it when needed, and the chat LLM comes back right after the check).
     */
    public async verifyModel(modelPath: string): Promise<boolean> {
        await enterActivity('image', ['sd']);
        try {
            return await this.loadModel(modelPath);
        } finally {
            await leaveActivity('image');
        }
    }

    /**
     * One-off generation from the chat (/image, /edit): the chat LLM leaves the RAM for the
     * image model and comes back right after.
     */
    public async generateFromChat(req: ImageGenerationRequest): Promise<SDGenerateResult> {
        await enterActivity('image', ['sd']);
        try {
            return await this.generateImage({ ...req, negativePrompt: req.negativePrompt?.trim() || DEFAULT_NEGATIVE_PROMPT });
        } finally {
            await leaveActivity('image');
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
            markUnloaded('sd');
            logger.log('info', '[ImageGenService] SD NPU model unloaded');
        } catch (e) {
            logger.log('warn', '[ImageGenService] Error unloading SD model', e);
        }
    }
}

export const imageGenService = ImageGenService.getInstance();

