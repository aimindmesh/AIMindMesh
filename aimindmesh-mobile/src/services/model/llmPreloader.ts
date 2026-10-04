import { LLMConfig } from '../../types';
import { logger } from '../logger';
import { readSetting } from '../security/secretStore';
import { HeavyEngine, LLM_ENGINES, isHeavyWhisperModel, unloadEngines } from './modelOrchestrator';
import { detectDeviceContext, onDeviceContextSize } from '../llm/context/contextSize';

/** Local LLM engine a config chats with, or null when the chat runs on a cloud/server provider */
export function localLlmEngine(config: Partial<LLMConfig> | null | undefined): HeavyEngine | null {
    if (!config) return null;
    if (config.provider === 'genie-npu') return config.nativeModelPath || (config as any).genieModelPath ? 'genie' : null;
    if (config.provider === 'litert') return config.liteRTModelPath ? 'litert' : null;
    if (config.provider === 'native-gguf') {
        if (config.engine === 'litert') return config.liteRTModelPath ? 'litert' : null;
        return config.nativeModelPath ? 'gguf' : null;
    }
    return null;
}

/**
 * Loads the configured chat LLM, and only it: at startup, after a settings change, and when
 * the app comes back to the chat from image generation or a meeting. Same entry points as
 * the providers' own generation path, so the loaded model is exactly the one they expect.
 * A cloud/server provider frees any local LLM instead.
 */
export async function preloadConfiguredLLM(config: LLMConfig): Promise<void> {
    const engine = localLlmEngine(config);
    if (!engine) {
        await unloadEngines(LLM_ENGINES, 'chat uses a remote provider');
        return;
    }

    await detectDeviceContext(); // the auto context of the phone, before any load
    if (engine === 'gguf') {
        const { initializeNativeModel } = await import('../llm/providers/GGUF/initialization');
        await initializeNativeModel(config);
    } else if (engine === 'litert') {
        const { initLiteRTModel } = await import('../llm/providers/liteRT/plugin');
        const { FileSystemAdapter: Filesystem, Directory } = await import('../../utils/fileSystemAdapter');
        const uri = await Filesystem.getUri({ path: config.liteRTModelPath!, directory: Directory.Data });
        const ok = await initLiteRTModel({
            modelPath: uri.uri.replace('file://', ''),
            maxTokens: onDeviceContextSize(config),
            temperature: 0.8,
            backend: config.liteRTBackend || 'CPU',
            useNPU: config.liteRTUseNPU,
        });
        if (!ok) throw new Error('LiteRT model not loaded');
    } else {
        const { initGenieModel } = await import('../llm/providers/genieProvider');
        const ok = await initGenieModel(config.nativeModelPath || (config as any).genieModelPath, config);
        if (!ok) throw new Error('Genie model not loaded');
    }

    // The dedicated tool model (GGUF) follows its setting: loaded when on, freed when off
    const nativeLLM = await import('../llm/nativeLLM');
    const toolInfo = nativeLLM.getSlotModelInfo('tool');
    if (engine === 'gguf' && config.useDedicatedToolModel && config.toolUseModelPath) {
        if (!toolInfo.isLoaded || toolInfo.modelPath !== config.toolUseModelPath) {
            logger.log('info', `[LLMPreloader] Loading tool model: ${config.toolUseModelPath}`);
            await nativeLLM.initNativeModel({
                modelPath: config.toolUseModelPath,
                nCtx: Math.min(onDeviceContextSize(config), 4096), // tool calls are short
                useVulkan: config.useVulkan,
                useOpenCL: config.useOpenCL,
                nGpuLayers: config.nGpuLayers,
            }, 'tool');
        }
    } else if (toolInfo.isLoaded) {
        await nativeLLM.unloadNativeModelSlot('tool');
    }
}

/**
 * A voice call keeps speech recognition and the LLM in RAM together: with an on-device LLM a
 * heavy speech model (Voxtral, Whisper medium/large) does not fit next to it, so the call
 * refuses that combination. Returns the message to show, or null when the call can start.
 */
export function voiceCallMemoryConflict(sttProvider: string | undefined, whisperModelId?: string | null): string | null {
    const server = readSetting<{ enabled?: boolean; useAsDefaultProvider?: boolean } | null>('aimindmesh-server-settings', null);
    if (server?.enabled && server.useAsDefaultProvider) return null; // the answer comes from the server
    if (!localLlmEngine(readSetting<LLMConfig | null>('llm-config', null))) return null;
    if (sttProvider === 'voxtral') {
        return 'Voxtral and the on-device chat model do not fit in RAM together. For calls choose Vosk or a small Whisper model (Settings > Audio).';
    }
    if (sttProvider === 'whisper' && isHeavyWhisperModel(whisperModelId)) {
        return `Whisper "${whisperModelId}" and the on-device chat model do not fit in RAM together. For calls choose Vosk or a small Whisper model (tiny/base/small).`;
    }
    return null;
}
