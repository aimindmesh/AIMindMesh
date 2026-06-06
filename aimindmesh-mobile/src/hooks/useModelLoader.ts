import { useEffect, useState } from 'react';
import { logger } from '../services/logger';
import { LLMConfig, SpeechConfig } from '../types';

/**
 * Manages auto-loading of models at startup based on configuration.
 */
export const useModelLoader = (llmConfig: LLMConfig, speechConfig: SpeechConfig) => {
    const [isNativeLLMLoading, setIsNativeLLMLoading] = useState(false);

    useEffect(() => {
        const loadModels = async () => {
            // Log the configuration at startup
            logger.log('info', `Auto-load check - STT: ${speechConfig.sttProvider}, Vosk: ${speechConfig.voskModelId}, TTS: ${speechConfig.ttsProvider}, Piper: ${speechConfig.piperVoiceId}`);

            const needsNativeLLMLoad = llmConfig.provider === 'native-gguf' && llmConfig.nativeModelPath && llmConfig.engine !== 'litert';
            if (needsNativeLLMLoad) {
                setIsNativeLLMLoading(true);
            }

            // Refresh available models lists (for imported models)
            try {
                logger.log('info', 'Refreshing model lists at startup...');

                // Dynamic imports to avoid loading services if not needed
                const { listLocalVoskModels } = await import('../services/stt/voskModelDownloader');
                const { listLocalPiperVoices } = await import('../services/tts/piperVoiceDownloader');
                const { getLocalGgufModels } = await import('../services/model/modelDownloader');

                // Refresh lists - this ensures imported models are available
                const [voskModels, piperVoices, ggufModels] = await Promise.all([
                    listLocalVoskModels().catch(() => []),
                    listLocalPiperVoices().catch(() => []),
                    getLocalGgufModels().catch(() => [])
                ]);

                logger.log('info', `Found ${voskModels.length} Vosk models, ${piperVoices.length} Piper voices, ${ggufModels.length} GGUF models`);
            } catch (error) {
                logger.log('warn', 'Failed to refresh model lists at startup', error);
            }

            try {
                // Load Vosk model if Vosk is selected and a model is configured
                if (speechConfig.sttProvider === 'vosk' && speechConfig.voskModelId) {
                    logger.log('info', `Vosk STT selected, importing service...`);
                    const { getVoskSttService } = await import('../services/stt/voskSTT');
                    const voskService = getVoskSttService();

                    if (!voskService.isModelLoaded() || voskService.getCurrentModelId() !== speechConfig.voskModelId) {
                        logger.log('info', `Auto-loading Vosk model: ${speechConfig.voskModelId}`);
                        await voskService.loadModel(speechConfig.voskModelId);
                        logger.log('info', `Vosk model loaded successfully: ${speechConfig.voskModelId}`);
                    }
                }
            } catch (error) {
                logger.log('error', 'Failed to auto-load Vosk model', error);
            }

            try {
                // Load Voxtral model if Voxtral is selected and a model is configured
                if (speechConfig.sttProvider === 'voxtral') {
                    logger.log('info', `Voxtral STT selected, importing service...`);
                    const { getVoxtralSttService } = await import('../services/stt/voxtralSTT');
                    const voxtralService = getVoxtralSttService();

                    let modelPath = speechConfig.voxtralModel;

                    // Fallback: if no model selected, try to find one
                    if (!modelPath) {
                        try {
                            const { listLocalVoxtralModels } = await import('../services/stt/voxtralModelDownloader');
                            const models = await listLocalVoxtralModels();
                            if (models.length > 0) {
                                modelPath = models[0];
                                logger.log('info', `No Voxtral model configured, auto-selecting: ${modelPath}`);
                            } else {
                                logger.log('warn', 'Voxtral selected but no models found on device.');
                            }
                        } catch (e) {
                            logger.log('warn', 'Failed to list Voxtral models for auto-selection', e);
                        }
                    }

                    if (modelPath && (!voxtralService.checkModelLoaded() || voxtralService.getCurrentModelPath() !== modelPath)) {
                        logger.log('info', `Auto-loading Voxtral model: ${modelPath}`);
                        await voxtralService.loadModel({
                            modelPath: modelPath,
                            transcriptionDelayMs: speechConfig.voxtralLatency,
                            nThreads: speechConfig.voxtralThreads,
                            maxModelLen: speechConfig.voxtralMaxLen
                        });
                        logger.log('info', `Voxtral model loaded successfully`);
                    }
                }
            } catch (error) {
                logger.log('error', 'Failed to auto-load Voxtral model', error);
            }

            try {
                // Load Piper voice if Piper is selected and a voice is configured
                if (speechConfig.ttsProvider === 'piper' && speechConfig.piperVoiceId) {
                    try {
                        const { getPiperTtsService } = await import('../services/tts/piperTTS');
                        const piperService = getPiperTtsService();

                        if (!piperService.isVoiceLoaded() || piperService.getCurrentVoiceId() !== speechConfig.piperVoiceId) {
                            logger.log('info', `Auto-loading Piper voice: ${speechConfig.piperVoiceId}`);
                            await piperService.loadVoice(speechConfig.piperVoiceId);
                            logger.log('info', `Piper voice loaded successfully`);
                        }
                    } catch (error) {
                        logger.log('error', 'Failed to auto-load Piper voice', error);
                    }
                }
            } catch (error) {
                logger.log('error', 'Error in Piper loading block', error);
            }

            try {
                // Load Kokoro voice if Kokoro is selected and a voice is configured
                if (speechConfig.ttsProvider === 'kokoro' && speechConfig.kokoroVoiceId) {
                    try {
                        const { getKokoroTtsService } = await import('../services/tts/kokoroTTS');
                        const kokoroService = getKokoroTtsService();

                        if (!kokoroService.isVoiceLoaded() || kokoroService.getCurrentVoiceId() !== speechConfig.kokoroVoiceId) {
                            logger.log('info', `Auto-loading Kokoro voice: ${speechConfig.kokoroVoiceId}`);
                            await kokoroService.loadVoice(speechConfig.kokoroVoiceId);
                            logger.log('info', `Kokoro voice loaded successfully`);
                        }
                    } catch (error) {
                        logger.log('error', 'Failed to auto-load Kokoro voice', error);
                    }
                }
            } catch (error) {
                logger.log('error', 'Error in Kokoro loading block', error);
            }

            try {
                // Load native LLM model if native-gguf is selected AND engine is NOT litert
                if (llmConfig.provider === 'native-gguf' && llmConfig.nativeModelPath && llmConfig.engine !== 'litert') {
                    const { initNativeModel, getCurrentModelInfo } = await import('../services/llm/nativeLLM');
                    const currentInfo = getCurrentModelInfo();
                    if (!currentInfo.isLoaded || currentInfo.modelPath !== llmConfig.nativeModelPath) {
                        logger.log('info', `Auto-loading native LLM: ${llmConfig.nativeModelPath}`);
                        try {
                            await initNativeModel({
                                modelPath: llmConfig.nativeModelPath,
                                nThreads: llmConfig.nThreads || 4,
                                nThreadsBatch: llmConfig.nThreadsBatch,
                                nCtx: llmConfig.nCtx || 2048,
                                nBatch: llmConfig.nBatch,
                                flashAttn: llmConfig.flashAttn,
                                useMmap: llmConfig.useMmap,
                                useVulkan: llmConfig.useVulkan,
                                useOpenCL: llmConfig.useOpenCL,
                                nGpuLayers: llmConfig.nGpuLayers,
                            });
                            logger.log('info', 'Native LLM loaded successfully');
                        } finally {
                            setIsNativeLLMLoading(false);
                        }
                    } else {
                        console.log('[ModelLoader-DEBUG] Local state says loaded, calling initNativeModel anyway for persistence check');
                        // [CRITICAL FIX] Still call initNativeModel - it will check native state and return early if already loaded
                        try {
                            await initNativeModel({
                                modelPath: llmConfig.nativeModelPath,
                                nThreads: llmConfig.nThreads || 4,
                                nThreadsBatch: llmConfig.nThreadsBatch,
                                nCtx: llmConfig.nCtx || 2048,
                                nBatch: llmConfig.nBatch,
                                flashAttn: llmConfig.flashAttn,
                                useMmap: llmConfig.useMmap,
                                useVulkan: llmConfig.useVulkan,
                                useOpenCL: llmConfig.useOpenCL,
                                nGpuLayers: llmConfig.nGpuLayers,
                            });
                        } finally {
                            setIsNativeLLMLoading(false);
                        }
                    }
                }

                // Auto-load LiteRT model if engine is litert
                if (llmConfig.engine === 'litert' && llmConfig.liteRTModelPath) {
                    setIsNativeLLMLoading(true);
                    logger.log('info', `Auto-loading LiteRT model: ${llmConfig.liteRTModelPath}`);
                    try {
                        const { initLiteRTModel } = await import('../services/llm/providers/liteRTProvider');
                        // Always call initLiteRTModel. Native layer natively reuses the engine
                        // if properties matching identical existing engine, or recreates if not.

                        // Resolve full path
                        // Use adapter instead of direct import
                        const { FileSystemAdapter: Filesystem, Directory } = await import('../utils/fileSystemAdapter');
                        const uriResult = await Filesystem.getUri({
                            path: llmConfig.liteRTModelPath,
                            directory: Directory.Data
                        });
                        const absolutePath = uriResult.uri.replace('file://', '');

                        await initLiteRTModel({
                            modelPath: absolutePath,
                            maxTokens: llmConfig.contextSize || llmConfig.nCtx || 8192,
                            temperature: 0.8,
                            backend: llmConfig.liteRTBackend || 'CPU',
                            useNPU: llmConfig.liteRTUseNPU
                        });
                        logger.log('info', 'LiteRT model load requested successfully');
                    } catch (liteRTError) {
                        logger.log('error', 'Failed to auto-load LiteRT model', liteRTError);
                    } finally {
                        setIsNativeLLMLoading(false);
                    }
                }

                // Auto-load tool model if configured
                if (llmConfig.useDedicatedToolModel && llmConfig.toolUseModelPath) {
                    const { initNativeModel, getSlotModelInfo } = await import('../services/llm/nativeLLM');
                    const toolInfo = getSlotModelInfo('tool');
                    if (!toolInfo.isLoaded || toolInfo.modelPath !== llmConfig.toolUseModelPath) {
                        logger.log('info', `Auto-loading tool model: ${llmConfig.toolUseModelPath}`);
                        try {
                            await initNativeModel({
                                modelPath: llmConfig.toolUseModelPath,
                                nCtx: llmConfig.nCtx || 2048,
                                useVulkan: llmConfig.useVulkan,
                                useOpenCL: llmConfig.useOpenCL,
                                nGpuLayers: llmConfig.nGpuLayers,
                            }, 'tool');
                            logger.log('info', 'Tool model loaded successfully');
                        } catch (toolError) {
                            logger.log('error', 'Failed to auto-load tool model', toolError);
                        }
                    }
                }
            } catch (error) {
                logger.log('error', 'Failed to auto-load native LLM', error);
                setIsNativeLLMLoading(false);
            }
        };

        loadModels();
    }, [
        speechConfig.sttProvider, speechConfig.voskModelId,
        speechConfig.ttsProvider, speechConfig.piperVoiceId, speechConfig.kokoroVoiceId,
        llmConfig.provider, llmConfig.nativeModelPath, llmConfig.engine,
        llmConfig.nThreads, llmConfig.nCtx, llmConfig.flashAttn,
        llmConfig.toolUseModelPath, llmConfig.useDedicatedToolModel,
        llmConfig.liteRTModelPath, llmConfig.contextSize,
        llmConfig.useVulkan, llmConfig.useOpenCL,
        llmConfig.liteRTBackend, llmConfig.liteRTUseNPU,
    ]);

    return { isNativeLLMLoading };
};
