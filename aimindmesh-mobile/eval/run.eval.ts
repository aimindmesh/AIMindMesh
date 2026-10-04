/**
 * Evaluation run: every scenario through the app's real code, the model on llama-server.
 *   EVAL_SMOKE=1        smoke subset only
 *   EVAL_FILTER=regex   scenario ids/categories to run
 *   EVAL_SAMPLES=3      runs per scenario (default 1)
 *   EVAL_THINKING=on|off  (default on: the user's current setting)
 *   EVAL_PERSONA=Atlas|Aria (by name), EVAL_NCTX=2048, EVAL_NAME=label
 *   EVAL_PHONE=serial (+ EVAL_MODEL, EVAL_PORT): the engine is GenieX on that phone, not llama-server
 */
import { describe, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, version: 'eval', getDocument: () => { throw new Error('no PDFs in eval'); } }));
// EVAL_PHONE=<serial>: the engine is GenieX on that phone (through DevTools), the code the PC's
vi.mock('genie-capacitor', async () => ({
    Genie: process.env.EVAL_PHONE ? (await import('./harness/phoneShim')).phoneShim : (await import('./harness/genieShim')).genieShim,
}));
vi.mock('../src/services/logger', () => ({ logger: { log: () => {}, logToAppOnly: () => {}, getIsEnabled: () => false, subscribe: () => () => {}, getLogs: () => [] } }));
vi.mock('../src/services/model/modelOrchestrator', () => ({
    ensureResident: async () => {}, markUnloaded: () => {}, getActivity: () => 'chat', onModelTransition: () => () => {},
}));
vi.mock('../src/services/memory/semanticMemoryRetriever', async () => {
    const { episodic } = await import('./harness/episodic');
    return {
        getOrInitializeSemanticMemoryRetriever: async () => ({
            retrieveRelevantMemories: async () => episodic.memories,
            truncateToTokenLimit: (found: unknown[]) => found,
            saveMessage: async () => {},
        }),
    };
});
vi.mock('../src/services/llm/contextInjector', () => ({ contextInjector: { buildSystemPromptWithContext: async () => '' } }));
vi.mock('../src/services/model/embedding/embeddingRuntime', () => ({ ensureEmbeddingModel: async () => false, embedText: async () => { throw new Error('no embeddings in eval'); } }));

import type { LLMConfig } from '../src/types';
import { PRESET_PERSONALITIES } from '../src/constants';
import { shimState } from './harness/genieShim';
import { serverModel } from './harness/llamaServer';
import { runChatTurn, runExtraction, HARNESS_MIRRORS } from './harness/runners';
import { passed, scoreAnswer, scoreFacts, scoreRemember, scoreToolCall, type Check } from './harness/scoring';
import { summarize, writeReport, type RunRecord } from './harness/report';
import type { Scenario } from './harness/types';

const env = process.env;
const scenarioDir = new URL('./scenarios/', import.meta.url).pathname;
const all: Scenario[] = readdirSync(scenarioDir).filter(f => f.endsWith('.json'))
    .flatMap(f => JSON.parse(readFileSync(scenarioDir + f, 'utf8')) as Scenario[]);
const filter = env.EVAL_FILTER ? new RegExp(env.EVAL_FILTER, 'i') : null;
const scenarios = all.filter(s => (!env.EVAL_SMOKE || s.smoke) && (!filter || filter.test(s.id) || filter.test(s.category)));
const samples = Number(env.EVAL_SAMPLES || 1);

describe.skipIf(!!env.EVAL_DEVICE)('AIMindMesh on-device eval', () => {
    it(`${scenarios.length} scenarios × ${samples}`, async () => {
        const phoneModel = env.EVAL_MODEL || 'gemma-4-E2B_q4_0-it.gguf';
        const model = env.EVAL_PHONE ? phoneModel.split('/').pop()! : await serverModel();
        shimState.modelPath = env.EVAL_PHONE ? phoneModel : `/data/user/0/com.aimindmesh.mobile/files/${model}`;
        const wanted = (env.EVAL_PERSONA || 'Atlas').toLowerCase();
        const persona = Object.values(PRESET_PERSONALITIES).find(p => p.name.toLowerCase() === wanted) ?? PRESET_PERSONALITIES.professional;
        const base = {
            provider: 'genie-npu', engine: 'genie', nativeModelPath: shimState.modelPath,
            enableToolCalling: true, enableThinking: (env.EVAL_THINKING || 'on') !== 'off',
            nCtx: Number(env.EVAL_NCTX || 8192), contextMode: 'manual', enableSemanticMemory: true, embeddingModelId: 'eval-mock',
            toolConfirmationMode: 'never',
        } as unknown as LLMConfig;
        const records: RunRecord[] = [];
        for (const scenario of scenarios) {
            for (let sample = 1; sample <= samples; sample++) {
                if (env.EVAL_PHONE) await (await import('./harness/deviceCdp')).waitUntilCool(env.EVAL_PHONE);
                let checks: Check[];
                let answer: string;
                let promptTokens = 0, ms = 0;
                let extra: Record<string, unknown> = {};
                try {
                    if (scenario.category === 'extraction') {
                        const out = await runExtraction(scenario, base);
                        checks = scoreFacts(out.saved, scenario.expect, out.now);
                        answer = out.saved.map(f => `[${f.kind}${f.dueAt ? ' ' + new Date(f.dueAt).toISOString().slice(0, 10) : ''}] ${f.content}`).join(' | ') || '(nothing saved)';
                        promptTokens = out.promptTokens; ms = out.ms;
                        extra = { raw: out.raw.slice(0, 800) };
                    } else {
                        const out = await runChatTurn(scenario, persona, base);
                        checks = [
                            ...scoreToolCall(out.calls, scenario.expect),
                            ...scoreRemember(out.inlineSaved, out.calls, scenario.expect.remembers),
                            ...(out.calls.length === 0 ? scoreAnswer(out.answer, scenario.expect) : []),
                        ];
                        answer = out.calls.length ? `TOOL ${out.calls.map(c => `${c.name}(${JSON.stringify(c.args)})`).join(', ')}` : out.answer;
                        promptTokens = out.promptTokens; ms = out.ms;
                        extra = { raw: out.raw.slice(0, 800), inlineSaved: out.inlineSaved, thinking: out.thinking.slice(0, 300), ...(env.EVAL_DUMP ? { prompt: out.prompt } : {}) };
                    }
                } catch (e) {
                    checks = [{ name: 'run', ok: false, detail: String(e).slice(0, 200) }];
                    answer = `(error) ${String(e).slice(0, 200)}`;
                }
                const record: RunRecord = { id: scenario.id, category: scenario.category, sample, ok: passed(checks), checks, answer, promptTokens, ms, extra };
                records.push(record);
                console.log(`${record.ok ? 'PASS' : 'FAIL'} ${scenario.id}#${sample} ${(ms / 1000).toFixed(1)}s ${promptTokens}tok :: ${answer.replace(/\s+/g, ' ').slice(0, 140)}`);
            }
        }
        const name = `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}-${model.replace(/\.gguf$/, '')}-${env.EVAL_NAME || 'run'}`;
        const md = writeReport(name, { model, persona: persona.name, thinking: base.enableThinking, nCtx: base.nCtx, samples, scenarios: scenarios.length, harnessMirrors: HARNESS_MIRRORS }, records);
        console.log(md.split('## Failures')[0]);
        console.table(summarize(records));
    });
});
