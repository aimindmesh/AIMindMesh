/**
 * One scenario through the app's real code paths:
 * - chat turn: the app's agent runner over generateTextResponseStreamWithTools (prompt context,
 *   provider, tool parsing, loop control, answer cleaning);
 * - extraction: the consolidation steps of consolidationScheduler on one batch.
 */
import type { LLMConfig, Message, Personality } from '../../src/types';
import { generateTextResponseStreamWithTools } from '../../src/services/llm/llmService';
import { getMaxTokensForStyle } from '../../src/services/llm/responseUtils';
import { runAgent } from '../../src/services/agent/agentRunner';
import { resolveLanguage } from '../../src/services/llm/prompt/languageRule';
import { runBackgroundTask } from '../../src/services/llm/background/backgroundLlm';
import { inlineFactsToSave } from '../../src/services/memory/facts/factQuality';
import { factStore } from '../../src/services/memory/facts/factStore';
import { LocalFactRepository } from '../../src/services/memory/facts/factRepository';
import {
    applyOps, buildConsolidationPrompt, CONSOLIDATION_SYSTEM_PROMPTS, FACT_OPS_GRAMMAR, knownFactsFor, parseOps, validateOps,
} from '../../src/services/memory/facts/factConsolidator';
import type { FactKind } from '../../src/services/memory/facts/factTypes';
import { resetShim, shimState } from './genieShim';
import { setEpisodic } from './episodic';
import type { Scenario, ScenarioTurn } from './types';
import type { SavedFact } from './scoring';

/** Chat turns run through the shared agent runner (src/services/agent/agentRunner.ts) */
export const HARNESS_MIRRORS = ['agentRunner', 'canned tool results', 'confirmations granted', 'no history compression'];


const DAY = 86_400_000;

async function seedFacts(scenario: Scenario, now: number) {
    // Facts live in localStorage in the harness: each scenario starts from an empty store
    localStorage.clear();
    factStore.resetForTests();
    await factStore.init(new LocalFactRepository());
    for (const f of scenario.facts ?? []) {
        await factStore.add({
            content: f.content, kind: (f.kind ?? 'other') as FactKind, importance: f.importance ?? 3, subject: f.subject,
            dueAt: f.dueInDays !== undefined ? now + f.dueInDays * DAY : undefined, source: 'manual',
        });
    }
}

const toMessage = (t: ScenarioTurn, i: number, now: number): Message =>
    ({ id: `m${i}`, role: t.role, text: t.text, timestamp: new Date(now - (t.minutesAgo ?? 0) * 60_000) });

export interface ChatOutcome {
    answer: string;
    raw: string;
    thinking: string;
    calls: Array<{ name: string; args: Record<string, unknown> }>;
    inlineSaved: string[];
    promptTokens: number;
    generatedTokens: number;
    ms: number;
    prompt: string;
    steps: number;
}

/**
 * A chat turn through the app's agent runner (the same loop as the chat): tools return the
 * scenario's canned results, confirmations are granted.
 */
export async function runChatTurn(scenario: Scenario, persona: Personality, base: LLMConfig): Promise<ChatOutcome> {
    const now = Date.now();
    await seedFacts(scenario, now);
    setEpisodic(scenario.memories);
    resetShim();
    const history = [...(scenario.history ?? []).map((t, i) => toMessage(t, i, now)), toMessage({ role: 'user', text: scenario.user ?? '' }, 999, now)];
    const calls: ChatOutcome['calls'] = [];
    const language = resolveLanguage(base.assistantLanguage, [scenario.user ?? '']);
    const outcome = await runAgent({ history, config: base, onDevice: true, language, threadId: scenario.id }, {
        generate: (h, config, signal) => generateTextResponseStreamWithTools(h, persona, config, undefined, signal, getMaxTokensForStyle('normal')),
        runTool: async call => {
            calls.push({ name: call.name, args: call.args ?? {} });
            const canned = scenario.toolResults?.[call.name];
            return { name: call.name, success: true, result: canned ?? `${call.name}: done.` };
        },
        isDenied: () => false,
        needsConfirmation: () => false,
    }, new AbortController().signal);
    const done = outcome.status === 'done' ? outcome : null;
    const last = shimState.last;
    const total = shimState.calls.reduce((s, c) => ({ p: s.p + c.promptTokens, g: s.g + c.generatedTokens, ms: s.ms + c.ms }), { p: 0, g: 0, ms: 0 });
    const chat = {
        answer: done?.text ?? `(${outcome.status})`, raw: last?.output ?? '', thinking: done?.thinking ?? '', calls,
        promptTokens: total.p, generatedTokens: total.g, ms: total.ms, prompt: shimState.calls[0]?.prompt ?? '', steps: shimState.calls.length,
    };
    // "Ricordati che…": the chat writes no facts, the background consolidation reads the turn
    let saved = inlineFactsToSave(done?.inlineFacts ?? []).save;
    if (scenario.expect.remembers && done) {
        const turn = [...history, { id: 'answer', role: 'model' as const, text: done.text, timestamp: new Date(now) }];
        saved = [...saved, ...(await consolidate(turn.slice(-4), base, now)).saved.map(f => f.content)];
    }
    return { ...chat, inlineSaved: saved };
}

export interface ExtractionOutcome { saved: SavedFact[]; raw: string; promptTokens: number; ms: number; now: number }

export async function runExtraction(scenario: Scenario, base: LLMConfig): Promise<ExtractionOutcome> {
    const now = Date.now();
    await seedFacts(scenario, now);
    resetShim();
    return consolidate((scenario.conversation ?? []).map((t, i) => toMessage(t, i, now)), base, now);
}

/** The background consolidation of consolidationScheduler on one batch of messages */
async function consolidate(batch: Message[], base: LLMConfig, now: number): Promise<ExtractionOutcome> {
    const before = new Set(factStore.active().map(f => f.id));
    const known = knownFactsFor(batch, factStore.active());
    const lang = resolveLanguage(base.assistantLanguage, batch.filter(m => m.role === 'user').map(m => m.text).reverse());
    const result = await runBackgroundTask({
        label: 'eval-extraction',
        prompt: buildConsolidationPrompt({ batch, known, now, maxChars: 2500, categories: [], lang }),
        systemPrompt: CONSOLIDATION_SYSTEM_PROMPTS[lang],
        maxTokens: 600,
        grammar: process.env.EVAL_GRAMMAR === 'off' ? undefined : FACT_OPS_GRAMMAR,
        requireIdleMs: 0,
        llmConfig: base,
    });
    const ops = result.text ? validateOps(parseOps(result.text), known, [], { batch, active: factStore.active(), now }) : [];
    await applyOps(ops, 'eval');
    const saved = factStore.active().filter(f => !before.has(f.id)).map(f => ({ content: f.content, kind: f.kind, dueAt: f.dueAt }));
    const last = shimState.last;
    return { saved, raw: result.text ?? `(skipped: ${result.skipped})`, promptTokens: last?.promptTokens ?? 0, ms: last?.ms ?? 0, now };
}
