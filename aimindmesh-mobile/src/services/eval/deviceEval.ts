/**
 * On-device eval harness (test builds only, VITE_AIMM_EVAL=1): `window.__aimmEval`, driven from
 * the PC through the WebView's DevTools (eval/device.eval.ts). It runs the scenarios of
 * eval/scenarios through the app's real code on the phone's engine (Genie NPU), isolated from
 * the user's data:
 * - facts: an in-memory store borrowed for the scenario (factStore.useRepository), never synced;
 * - past-conversation memories: the scenario's (evalHooks), no workspace documents;
 * - tools: canned results, nothing runs (no alarm, event, app or web request);
 * - a chat run marks chat activity, so background work does not take the engine meanwhile.
 */
import type { LLMConfig, Message, Personality } from '../../types';
import { PRESET_PERSONALITIES } from '../../constants';
import { Genie } from 'genie-capacitor';
import { evalHooks } from './evalHooks';
import { generateTextResponseStreamWithTools } from '../llm/llmService';
import { getMaxTokensForStyle } from '../llm/responseUtils';
import { runAgent } from '../agent/agentRunner';
import { resolveLanguage } from '../llm/prompt/languageRule';
import { readStoredLlmConfig } from '../llm/providerKeys';
import { initGenieModel } from '../llm/providers/genieProvider';
import { onGenieProfile, type GenieProfileRecord } from '../llm/npuStats';
import { beginChatActivity, isChatGenerating } from '../llm/background/chatActivity';
import { runBackgroundTask } from '../llm/background/backgroundLlm';
import { factStore } from '../memory/facts/factStore';
import { MemoryFactRepository } from '../memory/facts/factRepository';
import type { FactKind } from '../memory/facts/factTypes';
import {
    applyOps, buildConsolidationPrompt, CONSOLIDATION_SYSTEM_PROMPTS, FACT_OPS_GRAMMAR, knownFactsFor, parseOps, validateOps,
} from '../memory/facts/factConsolidator';
import { embedText, ensureEmbeddingModel } from '../model/embedding/embeddingRuntime';
import { resetToolRoutingForTests } from '../tools/routing/toolRouter';
import { logger } from '../logger';
import { isBackgroundTaskRunning } from '../llm/background/llmArbiter';

interface Turn { role: 'user' | 'model'; text: string; minutesAgo?: number }
interface Scenario {
    id: string;
    facts?: Array<{ content: string; kind?: string; importance?: number; subject?: string; dueInDays?: number }>;
    memories?: string[];
    history?: Turn[];
    toolResults?: Record<string, string>;
    user?: string;
    conversation?: Turn[];
}
export interface EvalOptions {
    modelPath: string;
    thinking?: boolean;
    persona?: string;
    /** Context set by hand; omitted: the phone's auto context */
    contextSize?: number;
    /** Run the consolidation on the turn afterwards ("ricordati che…" scenarios) */
    consolidate?: boolean;
    /** A chat run longer than this is stopped (default 5 minutes) */
    timeoutMs?: number;
}

/** Aborted after `ms`: a stuck run frees the engine instead of blocking the next scenarios */
function signalWithin(ms: number): AbortSignal {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
}

const DAY = 86_400_000;

function configFor(options: EvalOptions): LLMConfig {
    const stored = readStoredLlmConfig() ?? ({} as LLMConfig);
    return {
        ...stored,
        provider: 'genie-npu', engine: 'genie', nativeModelPath: options.modelPath,
        enableToolCalling: true, enableThinking: !!options.thinking, enableSearch: false,
        enableSemanticMemory: false, toolConfirmationMode: 'never', toolRules: {}, assistantLanguage: 'auto',
        ...(options.contextSize ? { contextMode: 'manual' as const, nCtx: options.contextSize, contextSize: options.contextSize } : { contextMode: 'auto' as const }),
    } as LLMConfig;
}

const personaOf = (name = 'Atlas'): Personality =>
    Object.values(PRESET_PERSONALITIES).find(p => p.name.toLowerCase() === name.toLowerCase()) ?? PRESET_PERSONALITIES.professional;

const toMessage = (t: Turn, i: number, now: number): Message =>
    ({ id: `m${i}`, role: t.role, text: t.text, timestamp: new Date(now - (t.minutesAgo ?? 0) * 60_000) });

/** Runs `work` with the scenario's facts and memories, the user's data out of reach */
async function isolated<T>(scenario: Scenario, now: number, work: () => Promise<T>): Promise<T> {
    const restore = await factStore.useRepository(new MemoryFactRepository());
    evalHooks.memories = (scenario.memories ?? []).map(content => ({ content, role: 'user', timestamp: Date.UTC(2026, 8, 20) }));
    evalHooks.noWorkspace = true;
    resetToolRoutingForTests();
    try {
        for (const f of scenario.facts ?? []) {
            await factStore.add({
                content: f.content, kind: (f.kind ?? 'other') as FactKind, importance: f.importance ?? 3, subject: f.subject,
                dueAt: f.dueInDays !== undefined ? now + f.dueInDays * DAY : undefined, source: 'manual',
            });
        }
        return await work();
    } finally {
        delete evalHooks.memories;
        delete evalHooks.noWorkspace;
        delete evalHooks.capture;
        await restore();
    }
}

/** Collects GenieX profiles and raw outputs while `work` runs */
async function recorded<T>(work: () => Promise<T>) {
    const profiles: GenieProfileRecord[] = [];
    const raws: Array<{ prompt: string; output: string }> = [];
    const stop = onGenieProfile(p => profiles.push(p));
    evalHooks.capture = (prompt, output) => raws.push({ prompt, output });
    try {
        const result = await work();
        return { result, profiles, raws };
    } finally {
        stop();
    }
}

async function chat(scenario: Scenario, options: EvalOptions) {
    const now = Date.now();
    const config = configFor(options);
    if (!await initGenieModel(options.modelPath, config)) throw new Error(`model not loaded: ${options.modelPath}`);
    return isolated(scenario, now, async () => {
        const history = [...(scenario.history ?? []).map((t, i) => toMessage(t, i, now)), toMessage({ role: 'user', text: scenario.user ?? '' }, 999, now)];
        const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
        const started = Date.now();
        // A chat generation: background work keeps off the engine meanwhile (and the
        // consolidation below, a background task itself, runs after it)
        const endActivity = beginChatActivity();
        const { result: outcome, profiles, raws } = await recorded(() => runAgent({
            history, config, onDevice: true, language: resolveLanguage(config.assistantLanguage, [scenario.user ?? '']), threadId: `eval-${scenario.id}`,
        }, {
            generate: (h, cfg, signal) => generateTextResponseStreamWithTools(h, personaOf(options.persona), cfg, undefined, signal, getMaxTokensForStyle('normal')),
            runTool: async call => {
                calls.push({ name: call.name, args: (call.args ?? {}) as Record<string, unknown> });
                return { name: call.name, success: true, result: scenario.toolResults?.[call.name] ?? `${call.name}: done.` };
            },
            isDenied: () => false,
            needsConfirmation: () => false,
        }, signalWithin(options.timeoutMs ?? 300_000))).finally(endActivity);
        const done = outcome.status === 'done' ? outcome : null;
        const ms = Date.now() - started;
        // "Ricordati che…": the chat writes no facts, the consolidation reads the turn
        let saved: string[] = [];
        if (options.consolidate && done) {
            const turn = [...history, { id: 'answer', role: 'model' as const, text: done.text, timestamp: new Date(now) }];
            saved = (await consolidateBatch(turn.slice(-4), config, now)).saved.map(f => f.content);
        }
        return {
            answer: done?.text ?? `(${outcome.status})`, thinking: done?.thinking ?? '', calls, ms,
            steps: raws.length, raws, profiles, saved,
        };
    });
}

/** The background consolidation on one batch (same steps as consolidationScheduler) */
async function consolidateBatch(batch: Message[], config: LLMConfig, now: number) {
    const before = new Set(factStore.active().map(f => f.id));
    const known = knownFactsFor(batch, factStore.active());
    const lang = resolveLanguage(config.assistantLanguage, batch.filter(m => m.role === 'user').map(m => m.text).reverse());
    const { result, profiles } = await recorded(() => runBackgroundTask({
        label: 'eval-extraction',
        prompt: buildConsolidationPrompt({ batch, known, now, maxChars: 2500, categories: [], lang }),
        systemPrompt: CONSOLIDATION_SYSTEM_PROMPTS[lang],
        maxTokens: 600,
        grammar: FACT_OPS_GRAMMAR,
        requireIdleMs: 0,
        llmConfig: config,
    }));
    const ops = result.text ? validateOps(parseOps(result.text), known, [], { batch, active: factStore.active(), now }) : [];
    await applyOps(ops, 'eval');
    const saved = factStore.active().filter(f => !before.has(f.id)).map(f => ({ content: f.content, kind: f.kind, dueAt: f.dueAt }));
    return { saved, raw: result.text ?? `(skipped: ${result.skipped})`, profiles };
}

async function extract(scenario: Scenario, options: EvalOptions) {
    const now = Date.now();
    const config = configFor(options);
    if (!await initGenieModel(options.modelPath, config)) throw new Error(`model not loaded: ${options.modelPath}`);
    return isolated(scenario, now, async () => {
        const started = Date.now();
        const out = await consolidateBatch((scenario.conversation ?? []).map((t, i) => toMessage(t, i, now)), config, now);
        return { ...out, ms: Date.now() - started, now };
    });
}

async function embed(texts: string[], kind: 'query' | 'passage', modelId?: string): Promise<number[][]> {
    const id = modelId ?? readStoredLlmConfig()?.embeddingModelId;
    if (!id || !await ensureEmbeddingModel(id)) throw new Error(`embedding model not available: ${id}`);
    const out: number[][] = [];
    for (const text of texts) out.push(Array.from((await embedText(text, kind)).vector));
    return out;
}

/** One scenario at a time: a call that arrives while another runs waits for it */
let queue: Promise<unknown> = Promise.resolve();
function serial<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
    return (...args: A) => {
        const run = queue.then(() => fn(...args), () => fn(...args));
        queue = run.catch(() => undefined);
        return run;
    };
}

/** What the harness and the app are doing (for a run that seems stuck) */
function state(lines = 40) {
    return {
        backgroundRunning: isBackgroundTaskRunning(), chatGenerating: isChatGenerating(),
        logs: logger.getLogs().slice(-lines).map(l => `${l.level} ${l.message}`.slice(0, 300)),
    };
}

async function info() {
    const [caps, loaded] = await Promise.all([Genie.getCapabilities(), Genie.isLoaded()]);
    const stored = readStoredLlmConfig();
    return { caps, loaded, provider: stored?.provider, embeddingModelId: stored?.embeddingModelId, enableThinking: stored?.enableThinking };
}

export function installDeviceEval(): void {
    logger.enable(false); // the harness reads the app's log; the user's setting is not changed
    (window as unknown as Record<string, unknown>).__aimmEval = {
        info, state, chat: serial(chat), extract: serial(extract), embed: serial(embed),
        load: serial((path: string, options: EvalOptions) => initGenieModel(path, configFor({ ...options, modelPath: path }))),
    };
    logger.log('info', '[DeviceEval] window.__aimmEval ready (test build)');
}
