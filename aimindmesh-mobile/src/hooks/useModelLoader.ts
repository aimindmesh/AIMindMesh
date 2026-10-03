import { useEffect, useState } from 'react';
import { logger } from '../services/logger';
import { LLMConfig } from '../types';
import { readSetting } from '../services/security/secretStore';
import { localLlmEngine, preloadConfiguredLLM } from '../services/model/llmPreloader';
import { getActivity, registerLlmRestorer } from '../services/model/modelOrchestrator';

/**
 * Loads the configured chat LLM at startup and when its settings change — and nothing else:
 * RAM is limited, so speech models load when a voice call or a meeting starts, TTS voices
 * with the first spoken reply, Stable Diffusion when the image screen opens (see
 * services/model/modelOrchestrator.ts for which models may stay in RAM together).
 */
export const useModelLoader = (llmConfig: LLMConfig) => {
    const [isNativeLLMLoading, setIsNativeLLMLoading] = useState(false);

    // How the orchestrator brings the chat model back after image generation or a meeting
    useEffect(() => {
        registerLlmRestorer(async () => {
            // Never saved yet: the app runs on its default (remote) provider, nothing to load
            const config = readSetting<LLMConfig | null>('llm-config', null);
            if (config) await preloadConfiguredLLM(config);
        });
        return () => registerLlmRestorer(null);
    }, []);

    useEffect(() => {
        // In image generation or a meeting the LLM is out of RAM on purpose: leaving restores it
        if (getActivity() !== 'chat') return;
        let cancelled = false;
        const isLocal = localLlmEngine(llmConfig) !== null;
        if (isLocal) setIsNativeLLMLoading(true);
        logger.log('info', `[ModelLoader] Chat model: ${llmConfig.provider}${isLocal ? ` (${localLlmEngine(llmConfig)})` : ' (remote, no local model)'}`);

        preloadConfiguredLLM(llmConfig)
            .catch(error => logger.log('error', '[ModelLoader] Failed to load the chat model', error))
            .finally(() => { if (!cancelled) setIsNativeLLMLoading(false); });
        return () => { cancelled = true; };
    }, [
        llmConfig.provider, llmConfig.nativeModelPath, llmConfig.engine,
        llmConfig.nThreads, llmConfig.nCtx, llmConfig.flashAttn,
        llmConfig.toolUseModelPath, llmConfig.useDedicatedToolModel,
        llmConfig.liteRTModelPath, llmConfig.contextSize,
        llmConfig.useVulkan, llmConfig.useOpenCL,
        llmConfig.liteRTBackend, llmConfig.liteRTUseNPU,
        llmConfig.enableVision, llmConfig.multimodalProj,
    ]);

    return { isNativeLLMLoading };
};
