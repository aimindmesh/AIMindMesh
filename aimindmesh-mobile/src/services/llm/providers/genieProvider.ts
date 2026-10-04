import { Message, Personality, LLMConfig } from '../../../types';
import { StreamChunk } from '../llmService';
import { logger } from '../../logger';
import { parseReActToolCalls } from '../../tools';
import { createThinkingParser } from '../thinkingParser';
import { buildPromptContext, historyWithTurnContext } from '../promptContext';
import { getReActSystemPromptCompact } from '../../toolDefinitions';
import { Genie } from 'genie-capacitor';
import { refineContext } from '../context/unifiedContextManager';
import { detectDeviceContext, setLoadedBundleContext } from '../context/contextSize';
import { budgetFor } from '../context/turnBudget';
import { ensureResident, markUnloaded } from '../../model/modelOrchestrator';
import { formatBundlePrompt, genieContextLength, genieLoadMatches, genieRuntime, isGgufPath, lastUserMessage, toTemplateMessages } from './genieSupport';
import { prepareImagesForProcessing } from './GGUF/mediaHandler';
import { recordGenieProfile } from '../npuStats';
import { modelFamily } from '../chatFormat/modelFamily';
import { withLanguageRule } from '../prompt/onDevicePrompt';
import { routedTools, taskGrammar } from '../background/taskFlags';
import { evalHooks } from '../../eval/evalHooks';
import { toolTemplateSupport } from '../chatFormat/nativeToolSupport';
import { formatGemma4Prompt } from '../chatFormat/gemma4Format';
import { toolStopSequences, visibleText, withoutThought } from '../chatFormat/nativeToolStream';
import { parseToolCalls } from '../chatFormat/toolCallParser';
import { PROMPT_TEXTS } from '../prompt/promptTexts';
import { ON_DEVICE_TOOLS, toolDeclarations } from '../../tools/nativeToolDeclarations';

let activeGenieModelPath: string | null = null;

export async function initGenieModel(modelPath: string, llmConfig?: LLMConfig): Promise<boolean> {
    try {
        await detectDeviceContext();
        const runtime = genieRuntime(llmConfig);
        const contextLength = genieContextLength(llmConfig, modelPath);
        const status = await Genie.isLoaded();
        if (status.loaded && (status.modelPath === modelPath || activeGenieModelPath === modelPath || !modelPath)
            && genieLoadMatches(status, runtime, contextLength)) {
            setLoadedBundleContext(status.runtime === 'llama_cpp' ? undefined : status.contextLength);
            logger.log('info', `[GenieProvider] Model already active (${status.runtime ?? 'qairt'} on ${status.computeUnit ?? 'npu'}): ${status.modelPath || modelPath}`);
            return true;
        }

        await ensureResident('genie');
        logger.log('info', `[GenieProvider] Loading ${modelPath} (${isGgufPath(modelPath) ? `GGUF, unit ${runtime}, n_ctx ${contextLength}` : 'QAIRT bundle'})`);
        const result = await Genie.loadModel({ modelPath, runtime, contextLength });

        if (result.success) {
            activeGenieModelPath = modelPath;
            setLoadedBundleContext(result.runtime === 'llama_cpp' ? undefined : result.contextLength);
            logger.log('info', `[GenieProvider] Model loaded: ${result.runtime ?? 'qairt'} on ${result.computeUnit ?? 'npu'}`);
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

    // Persona and the user profile in the system prompt; related memories and workspace documents
    // go into the user turn
    const budget = budgetFor(llmConfig, personality, maxResponseLength, genieContextLength(llmConfig, modelPath));
    // A short-answer rule made Gemma 4 E2B answer instead of calling the tool (0/4 calls vs 4/4):
    // it is left out on turns with tools, the token budget still bounds the answer
    const withTools = !!llmConfig.enableToolCalling || history.some(m => m.toolMeta);
    const promptContext = await buildPromptContext({
        personality, llmConfig, history, answerTokens: withTools ? undefined : budget.answer,
        onDevice: true, // compact prompt in the assistant's language
    });
    history = historyWithTurnContext(history, promptContext);
    let systemPrompt = promptContext.systemPrompt;
    // Gemma 4 and Qwen 3 get tools and reasoning in their own format (the chat template's tool
    // declarations and thinking flag); other models the ReAct prompt and the <thinking> instruction
    const family = modelFamily(modelPath);
    const language = promptContext.language ?? 'it';
    // Tool turns of this run stay in the native format also in the final, tool-free step
    const hasToolTurns = history.some(m => m.toolMeta);
    const support = (llmConfig.enableToolCalling || hasToolTurns) && family !== 'generic' ? await toolTemplateSupport(modelPath) : 'ignored';
    // Gemma 4 without a template (QAIRT bundle): the app writes its format, tools included. A
    // template that drops the tools (the Gemma-4-E4B QAIRT bundle's VLM template) keeps ReAct:
    // there the app-written format got 0/11 calls (JSON in markdown, "Input prompt too long")
    // against 10/11 with ReAct (Fold7)
    const appFormat = support === 'none' && family === 'gemma4';
    const nativeFormat = support === 'template' || appFormat;
    const nativeTools = !!llmConfig.enableToolCalling && nativeFormat;
    const nativeThinking = !!llmConfig.enableThinking && family !== 'generic' && (!llmConfig.enableToolCalling || nativeTools);
    if (nativeTools) {
        systemPrompt += '\n\n' + PROMPT_TEXTS[language].toolRules.map(r => `- ${r}`).join('\n');
    } else if (llmConfig.enableToolCalling) {
        systemPrompt += '\n' + getReActSystemPromptCompact(llmConfig.toolRules, routedTools(llmConfig));
    } else if (llmConfig.enableThinking && !nativeThinking) {
        systemPrompt += '\nIMPORTANT: Before answering, reason step-by-step. Show your thinking process enclosed in <thinking> and </thinking> tags.\nYour final answer goes AFTER the thinking tags.';
    }
    systemPrompt = withLanguageRule(systemPrompt, language);
    const declarations = nativeTools ? toolDeclarations(routedTools(llmConfig) ?? ON_DEVICE_TOOLS, llmConfig.toolRules) : [];
    const tools = nativeTools ? JSON.stringify(declarations) : undefined;

    // llmService skips pruning for on-device engines: fit history and answer in the NPU context here
    const llmParams = personality.llmParams || {};
    const refined = refineContext(history, systemPrompt, llmConfig, budget.requested, budget.context);
    history = refined.messages;
    systemPrompt = refined.systemPrompt;
    const maxTokens = budget.maxTokens;

    // Vision models (e.g. the Gemma 4 E4B bundle) see the images of the request being answered
    const isVision = (await Genie.isLoaded()).isVision === true;
    const lastUser = lastUserMessage(history);
    const images = isVision && lastUser?.images?.length ? await prepareImagesForProcessing([lastUser]) : [];

    // The model's own chat template (GGUF metadata, bundle tokenizer config): GenieX keeps the KV of
    // the common prefix between turns. Without one the prompt is formatted here (and has no image slots)
    let formatted: { prompt: string; stopSequences?: string[] } | null = null;
    if (appFormat) {
        formatted = {
            prompt: formatGemma4Prompt(toTemplateMessages(systemPrompt, history, 0, true), { tools: declarations, enableThinking: nativeThinking }),
            stopSequences: ['<turn|>', ...(nativeTools ? toolStopSequences(family) : [])],
        };
    } else try {
        formatted = {
            prompt: (await Genie.formatChat({ messages: toTemplateMessages(systemPrompt, history, images.length, nativeFormat), enableThinking: nativeThinking, tools })).prompt,
            stopSequences: nativeTools ? toolStopSequences(family) : undefined,
        };
    } catch (e) {
        logger.log('warn', '[GenieProvider] No chat template from the model, using the built-in format', e);
    }
    if ((!formatted || appFormat) && images.length > 0) logger.log('warn', `[GenieProvider] ${images.length} image(s) dropped: no chat template to place them`);
    const { prompt: formattedPrompt, stopSequences } = formatted ?? formatBundlePrompt(modelPath, systemPrompt, history, personality.name);
    const promptImages = formatted && !appFormat ? images : [];

    const thinkingParser = createThinkingParser();
    const chunkQueue: { text: string; done: boolean; error?: string }[] = [];
    let resolveQueue: (() => void) | null = null;
    let fullGeneratedText = '';
    let shownLength = 0;


    // Stopped before the NPU started (e.g. a background task the chat preempted)
    if (signal?.aborted) return;

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
                stopSequences,
                images: promptImages.length > 0 ? promptImages : undefined,
                // Structured tasks (memory extraction): GGUFs sample under the grammar
                grammar: isGgufPath(modelPath) ? taskGrammar(llmConfig) : undefined,
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
                if (result.profile) recordGenieProfile(result.profile, modelPath.split('/').pop() || modelPath);
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
                    // Native tool calls are parsed at the end, never shown as text
                    const visible = nativeTools ? visibleText(fullGeneratedText, family) : fullGeneratedText;
                    if (visible.length > shownLength) {
                        for (const parsed of thinkingParser.processChunk(visible.slice(shownLength))) yield parsed;
                        shownLength = visible.length;
                    }
                }

                if (chunk.done) break;
            } else {
                if (signal?.aborted) {
                    await Genie.abortGeneration();
                    break;
                }
                // addEventListener, not onabort: assigning onabort would replace the caller's handler
                let wakeOnAbort: (() => void) | undefined;
                await new Promise<void>(resolve => {
                    resolveQueue = resolve;
                    wakeOnAbort = () => resolve();
                    signal?.addEventListener('abort', wakeOnAbort, { once: true });
                }).finally(() => { if (wakeOnAbort) signal?.removeEventListener('abort', wakeOnAbort); });
            }
        }

        if (nativeTools) {
            const rest = visibleText(fullGeneratedText, family, true).slice(shownLength);
            if (rest) for (const parsed of thinkingParser.processChunk(rest)) yield parsed;
        }
        for (const parsed of thinkingParser.flush()) {
            yield parsed;
        }

        evalHooks.capture?.(formattedPrompt, fullGeneratedText);
        if (llmConfig.enableToolCalling) {
            const { calls } = nativeTools ? parseToolCalls(withoutThought(fullGeneratedText), family) : parseReActToolCalls(fullGeneratedText);
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
