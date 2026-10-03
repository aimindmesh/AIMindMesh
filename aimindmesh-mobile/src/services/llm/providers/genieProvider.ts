import { Message, Personality, LLMConfig, Memory } from '../../../types';
import { StreamChunk } from '../llmService';
import { logger } from '../../logger';
import { parseReActToolCalls } from '../../tools';
import { createThinkingParser } from '../thinkingParser';
import { buildSystemPrompt } from '../promptBuilder';
import { getReActSystemPromptCompact } from '../../toolDefinitions';
import { Genie } from 'genie-capacitor';
import { toChatRole } from '../roles';
import { refineContext, getResponseReserve } from '../context/unifiedContextManager';
import { ensureResident, markUnloaded } from '../../model/modelOrchestrator';

let activeGenieModelPath: string | null = null;

export async function initGenieModel(modelPath: string, llmConfig?: LLMConfig): Promise<boolean> {
    try {
        const { loaded, modelPath: currentLoadedPath } = await Genie.isLoaded();
        if (loaded && (currentLoadedPath === modelPath || activeGenieModelPath === modelPath || !modelPath)) {
            logger.log('info', `[GenieProvider] Model already active on Qualcomm NPU: ${currentLoadedPath || modelPath}`);
            return true;
        }

        await ensureResident('genie');
        logger.log('info', `[GenieProvider] Initializing model on Qualcomm Hexagon NPU: ${modelPath}`);
        const result = await Genie.loadModel({
            modelPath,
            runtime: 'npu',
            temperature: 0.7,
            topP: 0.9,
            contextLength: llmConfig?.contextSize || llmConfig?.nCtx || 4096,
        });

        if (result.success) {
            activeGenieModelPath = modelPath;
            logger.log('info', '[GenieProvider] Model successfully loaded on Qualcomm NPU');
            return true;
        } else {
            logger.log('error', `[GenieProvider] Failed to load model: ${result.error}`);
            return false;
        }
    } catch (e) {
        logger.log('error', '[GenieProvider] Exception initializing Genie model', e);
        return false;
    }
}

/** Native truth: a model may have been loaded before a WebView reload */
export async function isGenieModelLoaded(): Promise<boolean> {
    try {
        return (await Genie.isLoaded()).loaded;
    } catch {
        return activeGenieModelPath !== null;
    }
}

export async function unloadGenieModel(): Promise<void> {
    try {
        await Genie.unloadModel();
        activeGenieModelPath = null;
        markUnloaded('genie');
        logger.log('info', '[GenieProvider] Qualcomm NPU model unloaded');
    } catch (e) {
        logger.log('warn', '[GenieProvider] Error unloading model', e);
    }
}

export async function* generateGenieNPUStream(
    history: Message[],
    personality: Personality,
    llmConfig: LLMConfig,
    memories?: Memory[],
    signal?: AbortSignal,
    maxResponseLength?: number
): AsyncGenerator<StreamChunk> {
    const modelPath = llmConfig.nativeModelPath || (llmConfig as any).genieModelPath;
    if (!modelPath) {
        throw new Error('Genie NPU model path not configured. Please select or download a model.');
    }

    const initSuccess = await initGenieModel(modelPath, llmConfig);
    if (!initSuccess) {
        throw new Error(`Failed to initialize Qualcomm NPU engine for ${modelPath}`);
    }

    // Build system prompt
    let systemPrompt = buildSystemPrompt(personality, memories || [], undefined, true);
    if (llmConfig.enableToolCalling) {
        systemPrompt += '\n' + getReActSystemPromptCompact(llmConfig.toolRules);
    } else if (llmConfig.enableThinking) {
        systemPrompt += '\nIMPORTANT: Before answering, reason step-by-step. Show your thinking process enclosed in <thinking> and </thinking> tags.\nYour final answer goes AFTER the thinking tags.';
    }

    // llmService skips pruning for on-device engines: fit history and answer in the NPU context here
    const llmParams = personality.llmParams || {};
    const contextLength = llmConfig.contextSize || llmConfig.nCtx || 4096;
    const requestedTokens = llmParams.maxTokens ?? (maxResponseLength || 2048);
    const refined = refineContext(history, systemPrompt, llmConfig, requestedTokens, contextLength);
    history = refined.messages;
    systemPrompt = refined.systemPrompt;
    const maxTokens = getResponseReserve(contextLength, requestedTokens);

    // Format chat prompt formatted for Qwen / Gemma / Llama
    let formattedPrompt = '';
    const isQwen = modelPath.toLowerCase().includes('qwen');
    const isGemma = modelPath.toLowerCase().includes('gemma');

    if (isQwen) {
        // ChatML format for Qwen 2.5 / 3.5
        formattedPrompt = `<|im_start|>system\n${systemPrompt}<|im_end|>\n`;
        for (const msg of history) {
            const role = toChatRole(msg.role);
            formattedPrompt += `<|im_start|>${role}\n${msg.text}<|im_end|>\n`;
        }
        formattedPrompt += '<|im_start|>assistant\n';
    } else if (isGemma) {
        // Gemma turn format
        formattedPrompt = `<start_of_turn>system\n${systemPrompt}<end_of_turn>\n`;
        for (const msg of history) {
            const role = msg.role === 'model' ? 'model' : 'user';
            formattedPrompt += `<start_of_turn>${role}\n${msg.text}<end_of_turn>\n`;
        }
        formattedPrompt += '<start_of_turn>model\n';
    } else {
        // Generic transcript format
        formattedPrompt = `System: ${systemPrompt}\n\n`;
        for (const msg of history) {
            const role = msg.role === 'model' ? personality.name : 'User';
            formattedPrompt += `${role}: ${msg.text}\n\n`;
        }
        formattedPrompt += `${personality.name}: `;
    }

    const thinkingParser = createThinkingParser();
    const chunkQueue: { text: string; done: boolean; error?: string }[] = [];
    let resolveQueue: (() => void) | null = null;
    let fullGeneratedText = '';


    const onAbort = () => {
        Genie.abortGeneration().catch((e: any) => logger.log('warn', '[GenieProvider] Abort error', e));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
        await Genie.generateStream(
            {
                prompt: formattedPrompt,
                maxTokens,
                temperature: llmParams.temperature ?? 0.7,
                topP: llmParams.topP ?? 0.9,
                stopSequences: isQwen ? ['<|im_end|>', '<|endoftext|>'] : isGemma ? ['<end_of_turn>'] : undefined,
            },
            (result: any, err: any) => {
                if (err) {
                    chunkQueue.push({ text: '', done: true, error: err.message || 'Stream error' });
                    if (resolveQueue) { resolveQueue(); resolveQueue = null; }
                    return;
                }
                if (!result) {
                    if (resolveQueue) { resolveQueue(); resolveQueue = null; }
                    return;
                }
                chunkQueue.push({
                    text: result.text || '',
                    done: result.done || false,
                    error: result.error,
                });
                if (resolveQueue) { resolveQueue(); resolveQueue = null; }
            }
        );

        while (true) {
            if (chunkQueue.length > 0) {
                const chunk = chunkQueue.shift()!;
                if (chunk.error) {
                    throw new Error(chunk.error);
                }

                if (chunk.text) {
                    fullGeneratedText += chunk.text;
                    for (const parsed of thinkingParser.processChunk(chunk.text)) {
                        yield parsed;
                    }
                }

                if (chunk.done) break;
            } else {
                if (signal?.aborted) {
                    await Genie.abortGeneration();
                    break;
                }
                await new Promise<void>(resolve => {
                    resolveQueue = resolve;
                    if (signal) signal.onabort = () => resolve();
                });
            }
        }

        for (const parsed of thinkingParser.flush()) {
            yield parsed;
        }

        if (llmConfig.enableToolCalling) {
            const { calls } = parseReActToolCalls(fullGeneratedText);
            for (const call of calls) {
                yield { type: 'function_call', call };
            }
        }
    } catch (e: any) {
        logger.log('error', '[GenieProvider] Stream generation failed', e);
        throw e;
    } finally {
        signal?.removeEventListener('abort', onAbort);
    }
}
