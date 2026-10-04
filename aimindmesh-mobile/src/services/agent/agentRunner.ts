/**
 * The agent loop without React: generate, run the requested tools (pausing on those that need
 * the user's confirmation), feed their results back, until the model answers. The chat hook
 * (useAgenticLoop) adapts it to the UI; the evaluation harness drives the same code.
 */
import type { LLMConfig, Message } from '../../types';
import type { StreamChunk } from '../llm/llmService';
import type { ToolCall, ToolRunResult } from '../../hooks/chat/types';
import type { ImageAttachment } from '../../types';
import {
    buildObservationMessage, buildToolTurnText, cleanFinalAnswer, extractInlineMemories, mergeSources, mergeTextThinking, shouldNudgeModel,
} from '../../hooks/chat/agentLoopHelpers';
import { isRecallQuestion, redirectRecallToolCall } from '../memory/context/recallQuestion';
import { cleanAnswerText } from '../llm/prompt/answerHygiene';
import { PROMPT_TEXTS } from '../llm/prompt/promptTexts';
import type { ResolvedLanguage } from '../llm/prompt/languageRule';
import { callSignature, maxToolSteps, plannedTool } from './loopControl';
import { holdTurnContext } from '../llm/context/turnContextCache';
import { routeTools } from '../tools/routing/toolRouter';
import { checkToolArgs } from '../tools/routing/toolArgs';
import { routedTools, withRoutedTools } from '../llm/background/taskFlags';

type Source = { title: string; uri: string };

export interface AgentRunState {
    conversationHistory: Message[];
    currentIteration: number;
    maxIterations: number;
    accumulatedResponse: string;
    accumulatedThinking: string;
    accumulatedSources: Source[];
    accumulatedToolResults: ToolRunResult[];
    generatedImages: ImageAttachment[];
    /** Calls of the current batch not run yet; the first one may wait for confirmation */
    pendingToolCalls: ToolCall[];
    batchResults: ToolRunResult[];
    batchModelText: string;
    /** The calls of the current batch, in order (their results pair with batchResults) */
    batchCalls?: ToolCall[];
    /** Signatures of the calls already run in this run */
    executed: string[];
}

export interface AgentDeps {
    generate(history: Message[], config: LLMConfig, signal: AbortSignal): AsyncIterable<StreamChunk> | Promise<AsyncIterable<StreamChunk>>;
    runTool(call: ToolCall, state: AgentRunState): Promise<ToolRunResult>;
    isDenied(call: ToolCall): boolean;
    needsConfirmation(call: ToolCall): boolean;
    compress?(history: Message[]): Message[];
    update?(state: AgentRunState, status?: string): void;
    log?(level: 'info' | 'debug' | 'warn', message: string): void;
}

export interface AgentRunInput {
    history: Message[];
    /** Conversation id: the tools offered stay stable within it (toolRouter) */
    threadId?: string | null;
    config: LLMConfig;
    onDevice: boolean;
    language: ResolvedLanguage;
    resume?: { state: AgentRunState; decision?: { allowed: boolean } };
}

export type AgentOutcome =
    | { status: 'done'; text: string; thinking: string; state: AgentRunState; inlineFacts: string[] }
    | { status: 'paused'; call: ToolCall; state: AgentRunState }
    | { status: 'aborted' };

export function newRunState(history: Message[], maxIterations: number): AgentRunState {
    return {
        conversationHistory: history, currentIteration: 0, maxIterations, accumulatedResponse: '', accumulatedThinking: '',
        accumulatedSources: [], accumulatedToolResults: [], generatedImages: [], pendingToolCalls: [], batchResults: [],
        batchModelText: '', executed: [],
    };
}

const lastUser = (history: Message[]) => [...history].reverse().find(m => m.role !== 'model')?.text ?? '';

export async function runAgent(input: AgentRunInput, deps: AgentDeps, signal: AbortSignal): Promise<AgentOutcome> {
    // One prompt context per turn: the same memories at every step (and the engine's KV cache kept)
    const release = holdTurnContext();
    try {
        return await runSteps(input, deps, signal);
    } finally {
        release();
    }
}

async function runSteps(input: AgentRunInput, deps: AgentDeps, signal: AbortSignal): Promise<AgentOutcome> {
    const log = deps.log ?? (() => {});
    const texts = PROMPT_TEXTS[input.language];
    const state = input.resume?.state ?? newRunState(input.history, maxToolSteps(input.onDevice, input.config.maxAgentIterations));
    let decision = state.pendingToolCalls.length > 0 ? input.resume?.decision : undefined;
    const userText = lastUser(state.conversationHistory);

    // "Ricordi dove abito?": the turn context has the facts and memories; with tools the on-device
    // model looped on web searches (Fold7), without it answers
    const recall = input.config.enableToolCalling && isRecallQuestion(userText);
    let toolConfig: LLMConfig = recall ? { ...input.config, enableToolCalling: false } : input.config;
    if (recall && !input.resume) log('info', '[Agent] Recall question: answering from memory, no tools');
    // On-device models get only the tools the turn needs (none for small talk)
    if (input.onDevice && toolConfig.enableToolCalling) {
        const tools = routeTools(userText, input.threadId);
        toolConfig = tools.length > 0 ? withRoutedTools(toolConfig, tools) : { ...toolConfig, enableToolCalling: false };
        if (!input.resume) log('info', `[Agent] Tools for this turn: ${tools.join(', ') || 'none'}`);
    }
    const argErrors = new Map<string, number>();
    let nudgedToCall = false;
    let finalStep = false; // last generation: tools off, the model must answer

    let reasoningOff = false; // the reasoning used the whole budget once: the rest of the run answers without it
    const generateStep = async (stepConfig: LLMConfig) => {
        const config = reasoningOff ? { ...stepConfig, enableThinking: false } : stepConfig;
        if (deps.compress) state.conversationHistory = deps.compress(state.conversationHistory);
        const stream = await deps.generate(state.conversationHistory, config, signal);
        let response = '';
        let stepThinking = '';
        const calls: ToolCall[] = [];
        for await (const chunk of stream) {
            if (signal.aborted) break;
            if (chunk.type === 'text') {
                response = (response + chunk.content).replace(/^\s+/, '');
                state.accumulatedResponse = response;
                deps.update?.(state);
            } else if (chunk.type === 'thinking') {
                stepThinking += chunk.content;
                state.accumulatedThinking += chunk.content;
                deps.update?.(state);
            } else if (chunk.type === 'sources') {
                state.accumulatedSources = mergeSources(state.accumulatedSources, chunk.sources);
                deps.update?.(state);
            } else if (chunk.type === 'function_call') {
                const raw = chunk.call as { name: string; args?: Record<string, unknown>; arguments?: Record<string, unknown>; id?: string };
                const call = redirectRecallToolCall({ name: raw.name, args: raw.args || raw.arguments || {}, id: raw.id }, userText);
                if (call.name !== raw.name) log('info', `[Agent] Recall question: ${raw.name} → search_memory`);
                calls.push(call as ToolCall);
            }
        }
        return { response, stepThinking, calls };
    };

    for (;;) {
        if (signal.aborted) return { status: 'aborted' };

        if (state.pendingToolCalls.length === 0) {
            const outOfSteps = state.currentIteration >= state.maxIterations;
            if (outOfSteps && !finalStep) {
                // Tools ran up to the limit: one more turn without tools, so the user gets an answer
                // and not a dump of tool results
                finalStep = true;
                state.conversationHistory = [...state.conversationHistory, { id: `final_${Date.now()}`, role: 'user', text: texts.finalAnswer, timestamp: new Date(), hidden: true }];
            }
            const config = finalStep ? { ...toolConfig, enableToolCalling: false } : toolConfig;
            if (state.currentIteration > 0) deps.update?.(state, `🔄 ${state.currentIteration}/${state.maxIterations}`);
            state.accumulatedResponse = '';
            const { response, stepThinking, calls } = await generateStep(config);
            if (signal.aborted) return { status: 'aborted' };

            if (calls.length > 0 && config.enableToolCalling) {
                // A call already run with the same arguments is not run again: the model is told to answer
                // Never run a call twice: not one already run, not one repeated in the same output (the
                // Gemma-4-E4B QAIRT bundle wrote each call twice: two shopping items, two tasks)
                const fresh = calls.filter((c, i) => !state.executed.includes(callSignature(c))
                    && calls.findIndex(o => callSignature(o) === callSignature(c)) === i);
                if (fresh.length === 0) {
                    log('info', `[Agent] Repeated call ${calls[0].name}: forcing the answer`);
                    state.currentIteration = state.maxIterations;
                    continue;
                }
                state.pendingToolCalls = fresh;
                state.batchCalls = fresh;
                state.batchResults = [];
                // Only this step's reasoning goes back to the model (not every earlier step's)
                state.batchModelText = buildToolTurnText(response, stepThinking, fresh);
                state.accumulatedThinking = mergeTextThinking(state.accumulatedThinking, response);
            } else if (!finalStep && !nudgedToCall && config.enableToolCalling && plannedTool(stepThinking, routedTools(config))) {
                // Small models plan the call in their reasoning, then answer as if it had run
                // ("Ho aggiunto il latte"): the answer is dropped and the call asked for, once
                nudgedToCall = true;
                const tool = plannedTool(stepThinking, routedTools(config))!;
                log('info', `[Agent] ${tool} planned but not called: asking for the call`);
                state.conversationHistory = [...state.conversationHistory, { id: `nudge_${Date.now()}`, role: 'user', text: texts.callNow(tool), timestamp: new Date(), hidden: true }];
                state.currentIteration++;
                continue;
            } else if (input.onDevice && !reasoningOff && !response.trim() && stepThinking.trim().length >= 80) {
                // The reasoning took every token and no answer came (Gemma 4 E2B with thinking on):
                // the same step again without reasoning, instead of showing the reasoning as the answer
                reasoningOff = true;
                log('info', '[Agent] Reasoning used the whole budget: answering without it');
                state.accumulatedThinking = '';
                continue;
            } else if (!finalStep && shouldNudgeModel(response, stepThinking, state.currentIteration, state.maxIterations)) {
                state.conversationHistory = [
                    ...state.conversationHistory,
                    { id: `model_${Date.now()}`, role: 'model', text: stepThinking, timestamp: new Date() },
                    { id: `nudge_${Date.now()}`, role: 'user', text: texts.nudge, timestamp: new Date(), hidden: true },
                ];
                state.currentIteration++;
                continue;
            } else {
                break; // the answer
            }
        }

        // Run the batch in order; a call that needs confirmation pauses the run
        while (state.pendingToolCalls.length > 0) {
            if (signal.aborted) return { status: 'aborted' };
            // Arguments checked and repaired before anything runs; a wrong call goes back to the
            // model once, the second time it answers without tools
            if (!decision) {
                const pending = state.pendingToolCalls[0];
                const check = checkToolArgs(pending.name, pending.args as Record<string, unknown>);
                if (check.error && check.error !== `unknown tool ${pending.name}`) {
                    state.pendingToolCalls.shift();
                    const errors = (argErrors.get(pending.name) ?? 0) + 1;
                    argErrors.set(pending.name, errors);
                    log('info', `[Agent] ${pending.name}: ${check.error}`);
                    record(state, { name: pending.name, success: false, result: texts.toolError(pending.name, check.error) });
                    if (errors > 1) state.currentIteration = state.maxIterations;
                    continue;
                }
                state.pendingToolCalls[0] = { ...pending, args: check.args };
            }
            const call = state.pendingToolCalls[0];
            if (decision) {
                const { allowed } = decision;
                decision = undefined;
                state.pendingToolCalls.shift();
                state.executed.push(callSignature(call));
                record(state, allowed ? await deps.runTool(call, state) : { name: call.name, success: false, result: 'User denied execution.' });
                continue;
            }
            if (deps.isDenied(call)) {
                state.pendingToolCalls.shift();
                record(state, { name: call.name, success: false, result: "This tool is disabled in the user's settings." });
                continue;
            }
            if (deps.needsConfirmation(call)) {
                deps.update?.(state, `⏸️ ${call.name}`);
                return { status: 'paused', call, state };
            }
            state.pendingToolCalls.shift();
            state.executed.push(callSignature(call));
            record(state, await deps.runTool(call, state));
        }
        if (signal.aborted) return { status: 'aborted' };

        state.conversationHistory = [...state.conversationHistory, ...toolTurns(state, Date.now())];
        state.batchResults = [];
        state.batchModelText = '';
        state.batchCalls = [];
        state.accumulatedResponse = '';
        state.currentIteration++;
    }

    let finalText = state.accumulatedResponse;
    // Remote models may put a short answer in their reasoning; on-device the reasoning is never the answer
    if (!finalText.trim() && state.accumulatedThinking) finalText = input.onDevice ? texts.noAnswer : state.accumulatedThinking;
    const inlineFacts = extractInlineMemories(finalText);
    const text = cleanAnswerText(cleanFinalAnswer(finalText));
    return { status: 'done', text, thinking: state.accumulatedThinking, state, inlineFacts };
}

/**
 * The model turn with the batch's calls and the observation with their results. Both carry the
 * structured calls and results (toolMeta) for engines with a native tool format; each result
 * pairs with the call at the same position.
 */
function toolTurns(state: AgentRunState, stamp: number): Message[] {
    const calls = (state.batchCalls ?? []).map((c, i) => ({ id: `call_${stamp}_${i}`, name: c.name, args: (c.args ?? {}) as Record<string, unknown> }));
    const results = state.batchResults.map((r, i) => ({ id: calls[i]?.id ?? `call_${stamp}_${i}`, name: r.name, success: r.success, result: r.result }));
    const observation = buildObservationMessage(state.batchResults, `tool_${stamp}`);
    return [
        { id: `model_${stamp}`, role: 'model', text: state.batchModelText, timestamp: new Date(), toolMeta: calls.length > 0 ? { calls } : undefined },
        { ...observation, toolMeta: { results } },
    ];
}

function record(state: AgentRunState, result: ToolRunResult) {
    state.accumulatedToolResults.push(result);
    state.batchResults.push(result);
}
