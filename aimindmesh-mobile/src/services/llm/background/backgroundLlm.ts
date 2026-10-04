/**
 * Background generations (memory consolidation, summaries, proactive messages) with any
 * configured provider. They run outside React from the stored settings, one at a time
 * (llmArbiter), and step aside for the chat:
 * - an on-device engine is used only if it is already loaded, no other feature (image,
 *   meeting, voice) holds the device, and the chat has been quiet for `requireIdleMs`;
 * - the run is aborted as soon as the chat needs the model, and its partial text discarded.
 */
import { LLMConfig, Message, Personality, AIMindMeshServerSettings } from '../../../types';
import { logger } from '../../logger';
import { generateTextResponseStream } from '../llmService';
import { memoryTaskConfig } from '../../memory/memoryLlmConfig';
import { asBackgroundTask, withGrammar } from './taskFlags';
import { runExclusiveBackground } from './llmArbiter';
import { isChatIdleFor } from './chatActivity';
import {
    KEYED_PROVIDERS, isOnDeviceProvider, readStoredLlmConfig, readStoredServerSettings, storedApiKeyFor,
} from '../providerKeys';

/** User decision: on-device engines run background work only after 3 minutes of quiet chat */
export const ON_DEVICE_IDLE_MS = 3 * 60 * 1000;

export type BackgroundSkipReason =
    | 'no_config' | 'no_key' | 'chat_active' | 'engine_not_ready' | 'busy' | 'aborted' | 'empty' | 'error';

export interface BackgroundTaskOptions {
    /** Shown in logs and by the arbiter */
    label: string;
    /** The request (sent as the user message) */
    prompt: string;
    /** Instructions of an internal task (memory work): only this text is sent as system prompt */
    systemPrompt?: string;
    /** Persona of a user-facing text (proactive message): the full companion prompt is used */
    persona?: Personality;
    maxTokens?: number;
    /** GBNF the answer must follow, where the engine supports it (GenieX GGUF) */
    grammar?: string;
    /** On-device quiet time required (default ON_DEVICE_IDLE_MS) */
    requireIdleMs?: number;
    /** Settings to use instead of the stored ones */
    llmConfig?: LLMConfig;
    serverSettings?: AIMindMeshServerSettings;
}

export interface BackgroundTaskResult {
    text: string | null;
    skipped?: BackgroundSkipReason;
    /** Provider that ran (or would have run) the task */
    provider?: string;
}

/** Whether the server answers this config (the server then falls back to `fallbackProvider`). */
function routesToServer(config: LLMConfig, server: AIMindMeshServerSettings): boolean {
    if (!server.enabled) return false;
    return config.provider === 'aimindmesh-server' || !!server.useAsDefaultProvider;
}

/** The on-device engine of `config` is loaded (a background task never loads one). */
export async function isOnDeviceEngineReady(config: LLMConfig): Promise<boolean> {
    try {
        const { getActivity } = await import('../../model/modelOrchestrator');
        if (getActivity() !== 'chat') return false; // Image, meeting or voice owns the device
        if (config.provider === 'genie-npu') {
            const { isGenieModelLoaded } = await import('../providers/genieProvider');
            return await isGenieModelLoaded();
        }
        if (config.provider === 'litert' || (config.provider === 'native-gguf' && config.engine === 'litert' && config.liteRTModelPath)) {
            const { isLiteRTLoaded } = await import('../providers/liteRT/plugin');
            return await isLiteRTLoaded();
        }
        const { getSlotModelInfo } = await import('../nativeLLM');
        return getSlotModelInfo('chat').isLoaded;
    } catch (e) {
        logger.log('debug', '[BackgroundLLM] Engine readiness check failed', e);
        return false;
    }
}

export async function runBackgroundTask(options: BackgroundTaskOptions): Promise<BackgroundTaskResult> {
    const stored = options.llmConfig ?? readStoredLlmConfig();
    if (!stored) return { text: null, skipped: 'no_config' };
    const server = options.serverSettings ?? readStoredServerSettings();
    const viaServer = routesToServer(stored, server);
    // Engine that runs on the device: the provider itself, or the server's fallback
    const local = stored.provider === 'aimindmesh-server' ? (server.fallbackProvider ?? 'none') : stored.provider;

    // On-device engines only when quiet, loaded and free
    let localAllowed = local !== 'none';
    if (localAllowed && isOnDeviceProvider(local)) {
        const idle = isChatIdleFor(options.requireIdleMs ?? ON_DEVICE_IDLE_MS);
        const ready = idle && await isOnDeviceEngineReady({ ...stored, provider: local as LLMConfig['provider'] });
        if (!viaServer) {
            if (!idle) return { text: null, skipped: 'chat_active', provider: local };
            if (!ready) return { text: null, skipped: 'engine_not_ready', provider: local };
        }
        localAllowed = ready;
    }

    const apiKey = storedApiKeyFor(local, stored);
    if (!viaServer && KEYED_PROVIDERS.includes(local) && !apiKey) {
        return { text: null, skipped: 'no_key', provider: local };
    }

    // Through the server: no local fallback unless the device engine may run now
    const config: LLMConfig = viaServer ? { ...stored, provider: 'aimindmesh-server' } : stored;
    const serverSettings: AIMindMeshServerSettings | undefined = viaServer
        ? { ...server, fallbackProvider: localAllowed ? local as AIMindMeshServerSettings['fallbackProvider'] : 'none' }
        : undefined;
    const provider = viaServer ? 'aimindmesh-server' : local;

    const personality: Personality = options.persona ?? {
        name: 'Task', description: '', systemPrompt: options.systemPrompt ?? '', traits: [],
    };
    const taskConfig = withGrammar(asBackgroundTask(options.persona
        ? { ...config, enableToolCalling: false, enableThinking: false, enableSearch: false }
        : memoryTaskConfig(config)), options.grammar);
    // The server drops system prompts: its instructions travel with the request
    const instructions = options.persona ? `${options.persona.systemPrompt}` : (options.systemPrompt ?? '');
    const text = viaServer && instructions.trim() ? `${instructions.trim()}\n\n${options.prompt}` : options.prompt;
    const history: Message[] = [{
        role: 'user', text, id: options.persona ? 'proactive' : 'sys_memory_req', timestamp: new Date(),
    }];

    const outcome = await runExclusiveBackground(options.label, async (signal): Promise<BackgroundTaskResult> => {
        let output = '';
        try {
            for await (const chunk of generateTextResponseStream(history, personality, taskConfig, apiKey, signal, options.maxTokens, serverSettings)) {
                if (signal.aborted) break;
                if (typeof chunk === 'string') output += chunk;
                else if (chunk.type === 'text') output += chunk.content;
            }
        } catch (e) {
            if (signal.aborted) return { text: null, skipped: 'aborted', provider };
            logger.log('warn', `[BackgroundLLM] "${options.label}" failed on ${provider}`, e);
            return { text: null, skipped: 'error', provider };
        }
        // Some engines end an aborted stream normally: partial text is never used
        if (signal.aborted) return { text: null, skipped: 'aborted', provider };
        output = output.trim();
        return output ? { text: output, provider } : { text: null, skipped: 'empty', provider };
    }, provider);

    if (!outcome) return { text: null, skipped: 'busy', provider };
    logger.log('info', `[BackgroundLLM] "${options.label}" on ${provider}: ${outcome.text ? `${outcome.text.length} chars` : outcome.skipped}`);
    return outcome;
}
