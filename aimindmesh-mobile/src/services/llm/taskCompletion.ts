/**
 * Completions for app tasks (meeting notes and questions) with the user's AI provider. Unlike
 * the chat, the request carries the task's own instructions only: no companion persona, no
 * memories or workspace documents, no tools. The text is never truncated silently: a
 * transcript too long for the model fails with an error that says so.
 */

import { AIMindMeshServerSettings, LLMConfig, Message, Personality } from '../../types';
import { FileSystemAdapter as Filesystem, Directory } from '../../utils/fileSystemAdapter';
import { logger } from '../logger';
import { generateTextResponseStream } from './llmService';
import { asInternalTask } from './background/taskFlags';
import { getProviderContextWindow } from './context/unifiedContextManager';
import { geminiTaskStream, resolveGeminiTaskModel } from './providers/geminiTask';
import { openAICompatibleTaskStream, resolveOpenAICompatibleModel } from './providers/openAICompatibleTask';
import { audioExtensionForMime } from '../meeting/audioPaths';
import { filesystemRefFor } from '../meeting/meetingStorage';
import { onDeviceContextSize } from './context/contextSize';

/** API keys the providers need (they are not part of LLMConfig). */
export interface TaskKeys {
    gemini?: string;
    claude?: string;
    perplexity?: string;
}

export interface TaskAudio {
    /** Playable URL of the recording (fetched for providers that take the bytes) */
    url: string;
    /** Plain native path, when the recording is a file (on-device engines read it from there) */
    filePath?: string | null;
    mimeType: string;
}

export interface TaskRequest {
    system: string;
    prompt: string;
    llmConfig: LLMConfig;
    keys: TaskKeys;
    serverSettings?: AIMindMeshServerSettings;
    maxTokens: number;
    /** Ask for a JSON answer where the provider supports it (the prompt must ask for it too). */
    json?: boolean;
    signal?: AbortSignal;
    /** Gemini, an on-device LiteRT model: the recording itself */
    audio?: TaskAudio;
}

const routesToServer = (req: Pick<TaskRequest, 'llmConfig' | 'serverSettings'>) =>
    req.llmConfig.provider === 'aimindmesh-server' || (!!req.serverSettings?.enabled && !!req.serverSettings?.useAsDefaultProvider);

const isOnDeviceLiteRT = (config: LLMConfig) =>
    config.provider === 'litert' || (config.provider === 'native-gguf' && config.engine === 'litert');

/** The model a request will use, as shown to the user and stored with the results. */
export function describeTaskModel(config: LLMConfig, serverSettings?: AIMindMeshServerSettings): string {
    if (routesToServer({ llmConfig: config, serverSettings })) return 'AIMindMesh server';
    switch (config.provider) {
        case 'gemini': return resolveGeminiTaskModel(config.geminiModel);
        case 'openrouter': return resolveOpenAICompatibleModel({ llmConfig: config }, true);
        case 'local': return resolveOpenAICompatibleModel({ llmConfig: config }, false);
        case 'claude': return config.claudeModel || 'Claude';
        case 'perplexity': return config.perplexityModel || 'Perplexity';
        case 'native-gguf': return config.engine === 'litert' ? (config.liteRTModelId || 'LiteRT') : (config.selectedGGUF || 'on-device model');
        case 'litert': return config.liteRTModelId || 'LiteRT';
        case 'genie-npu': return config.genieModelId || 'Genie NPU';
        default: return config.provider;
    }
}

/** Whether the AI can be called at all (keys present, a local endpoint set...). */
export function isTaskLLMConfigured(config: LLMConfig, keys: TaskKeys, serverSettings?: AIMindMeshServerSettings): boolean {
    if (routesToServer({ llmConfig: config, serverSettings })) return !!serverSettings?.enabled;
    switch (config.provider) {
        case 'gemini': return !!keys.gemini?.trim();
        case 'claude': return !!keys.claude?.trim();
        case 'perplexity': return !!keys.perplexity?.trim();
        case 'openrouter': return !!config.openrouterApiKey?.trim();
        case 'local': return !!config.localEndpoint?.trim();
        case 'native-gguf': return !!(config.nativeModelPath || config.selectedGGUF || config.liteRTModelPath);
        case 'litert': return !!(config.liteRTModelPath || config.liteRTModelId);
        case 'genie-npu': return !!(config.genieModelPath || config.genieModelId);
        default: return false;
    }
}

/** Providers that take the recording itself: Gemini, and LiteRT models on the phone. */
export function supportsTaskAudio(config: LLMConfig, serverSettings?: AIMindMeshServerSettings): boolean {
    if (routesToServer({ llmConfig: config, serverSettings })) return false;
    return config.provider === 'gemini' || isOnDeviceLiteRT(config);
}

/** Rough token count of a text (~3.5 characters per token for European languages). */
export const estimateTokens = (text: string) => Math.ceil(text.length / 3.5);

/** The context window the request will be cut to by the chat layer, when there is one. */
function contextWindow(req: TaskRequest): number | undefined {
    if (routesToServer(req)) return getProviderContextWindow('aimindmesh-server');
    const provider = req.llmConfig.provider;
    if (provider === 'native-gguf' || provider === 'litert' || provider === 'genie-npu') {
        return onDeviceContextSize(req.llmConfig);
    }
    return getProviderContextWindow(provider);
}

/** Fails clearly instead of letting the chat layer drop part of the transcript. */
export function checkFits(req: TaskRequest): void {
    const window = contextWindow(req);
    if (!window) return;
    const needed = estimateTokens(req.system) + estimateTokens(req.prompt) + req.maxTokens;
    if (needed > window) {
        throw new Error(`This meeting is too long for ${describeTaskModel(req.llmConfig, req.serverSettings)} `
            + `(about ${needed} tokens, the model takes ${window}): choose a model with a larger context in Settings → LLM`);
    }
}

/** Drops reasoning blocks some models write before the answer. */
export function stripThinking(text: string): string {
    return text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^[\s\S]*?<\/think>/, '').trimStart();
}

/** Copies the recording to the cache with a real extension, for an on-device model. */
async function audioForLiteRT(audio: TaskAudio): Promise<{ path: string; cleanup: () => Promise<void> }> {
    const tempName = `task_audio_${Date.now()}.${audioExtensionForMime(audio.mimeType)}`;
    if (audio.filePath) {
        // Native copy: the recording never goes through JS memory
        const source = filesystemRefFor(audio.filePath);
        await Filesystem.copy({ from: source.path, directory: source.directory, to: tempName, toDirectory: Directory.Cache });
    } else {
        const blob = await (await fetch(audio.url)).blob();
        const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
        await Filesystem.writeFile({ path: tempName, data: base64, directory: Directory.Cache });
    }
    const { uri } = await Filesystem.getUri({ path: tempName, directory: Directory.Cache });
    return { path: uri, cleanup: () => Filesystem.deleteFile({ path: tempName, directory: Directory.Cache }).catch(() => { }) };
}

/** Everything else: the app's LLM layer, as an internal task (only this system text, no tools). */
async function* viaAppLayer(req: TaskRequest): AsyncGenerator<string> {
    const personality: Personality = { name: 'Meeting notes', description: '', systemPrompt: req.system, traits: [] };
    const config = asInternalTask({
        ...req.llmConfig,
        enableSemanticMemory: false,
        enableToolCalling: false,
        enableThinking: false,
        enableSearch: false
    } as LLMConfig);
    // The server drops system text: the instructions go with the request there
    const text = routesToServer(req) ? `${req.system}\n\n${req.prompt}` : req.prompt;
    let liteRTAudio: { path: string; cleanup: () => Promise<void> } | null = null;
    if (req.audio && isOnDeviceLiteRT(req.llmConfig)) liteRTAudio = await audioForLiteRT(req.audio);
    try {
        const history: Message[] = [{
            id: `task_${Date.now()}`,
            role: 'user',
            text,
            timestamp: new Date(),
            ...(liteRTAudio ? { audio: [{ path: liteRTAudio.path, name: 'meeting_audio', mimeType: req.audio!.mimeType }] } : {})
        } as Message];
        const apiKey = req.llmConfig.provider === 'claude' ? req.keys.claude
            : req.llmConfig.provider === 'perplexity' ? req.keys.perplexity
                : req.keys.gemini;
        for await (const chunk of generateTextResponseStream(history, personality, config, apiKey, req.signal, req.maxTokens, req.serverSettings)) {
            if (typeof chunk === 'string') yield chunk;
            else if (chunk.type === 'text' && chunk.content) yield chunk.content;
        }
    } finally {
        await liteRTAudio?.cleanup();
    }
}

/** Streams the model's answer to the task (with the recording when `audio` is set). */
export async function* streamTaskCompletion(req: TaskRequest): AsyncGenerator<string> {
    const provider = req.llmConfig.provider;
    logger.log('info', `[TaskCompletion] Request to ${provider} (${describeTaskModel(req.llmConfig, req.serverSettings)})`);
    if (req.audio && !supportsTaskAudio(req.llmConfig, req.serverSettings)) {
        throw new Error(`${describeTaskModel(req.llmConfig, req.serverSettings)} does not take audio: analyze the transcript instead.`);
    }
    if (!routesToServer(req) && provider === 'gemini') {
        const audio = req.audio ? { blob: await (await fetch(req.audio.url)).blob(), mimeType: req.audio.mimeType } : undefined;
        yield* geminiTaskStream(req, audio);
        return;
    }
    if (!routesToServer(req) && (provider === 'openrouter' || provider === 'local')) {
        yield* openAICompatibleTaskStream(req, provider === 'openrouter');
        return;
    }
    checkFits(req);
    yield* viaAppLayer(req);
}
