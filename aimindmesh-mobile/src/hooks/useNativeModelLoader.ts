import { useState, useEffect } from 'react';
import { ModelSlot, initNativeModel, unloadNativeModelSlot } from '../services/llm/nativeLLM';
import { LLMConfig } from '../types';
import { logger } from '../services/logger';

export const useNativeModelLoader = (
    llmConfig: LLMConfig,
    onLlmConfigSave: (config: LLMConfig) => void,
    triggerHaptic: () => void
) => {
    const [isNativeModelLoaded, setIsNativeModelLoaded] = useState(false);

    // Check load status
    useEffect(() => {
        const checkLoadStatus = async () => {
            const { getCurrentModelInfo } = await import('../services/llm/nativeLLM');
            const info = getCurrentModelInfo();
            setIsNativeModelLoaded(info.isLoaded && info.modelPath === llmConfig.nativeModelPath);
        };
        checkLoadStatus();
    }, [llmConfig.nativeModelPath]);

    const handleLoadNativeModel = async (modelId: string, slot: ModelSlot = 'chat') => {
        triggerHaptic();
        triggerHaptic();
        // If it looks like an absolute path (or external), use it directly. Otherwise append .gguf
        const filename = (modelId.includes('/') || modelId.includes('\\')) ? modelId : modelId + '.gguf';

        // Save the filename/path as provided (relative or absolute) for persistence
        if (slot === 'chat') {
            onLlmConfigSave({ ...llmConfig, nativeModelPath: filename });
        } else {
            onLlmConfigSave({ ...llmConfig, toolUseModelPath: filename });
        }

        try {
            // Loaded with the same path that is saved: generation compares the loaded path with
            // the configured one, and a resolved absolute path made the first message reload the
            // model. The native layer resolves bare file names itself.
            await initNativeModel({
                modelPath: filename,
                tokenizerPath: llmConfig.nativeTokenizerPath,
                nThreads: llmConfig.nThreads || 6,
                nThreadsBatch: llmConfig.nThreadsBatch || 4,
                nCtx: slot === 'tool' ? 2048 : (llmConfig.nCtx || 2048),
                nBatch: llmConfig.nBatch || 512,
                flashAttn: llmConfig.flashAttn ?? true,
                useMmap: llmConfig.useMmap ?? false,
                nGpuLayers: llmConfig.nGpuLayers,
                useOpenCL: llmConfig.useOpenCL,
                useVulkan: llmConfig.useVulkan,
            }, slot);

            if (slot === 'chat') {
                setIsNativeModelLoaded(true);
            }
        } catch (e) {
            logger.log('error', `Failed to load ${slot} model`, e);
            alert(`Failed to load ${slot} model: ` + (e as any).message);
        }
    };

    const handleUnloadNativeModel = async (slot: ModelSlot = 'chat') => {
        triggerHaptic();
        await unloadNativeModelSlot(slot);

        if (slot === 'chat') {
            setIsNativeModelLoaded(false);
            onLlmConfigSave({ ...llmConfig, nativeModelPath: undefined });
        } else {
            onLlmConfigSave({ ...llmConfig, toolUseModelPath: undefined });
        }
    };

    return {
        isNativeModelLoaded,
        handleLoadNativeModel,
        handleUnloadNativeModel
    };
};
