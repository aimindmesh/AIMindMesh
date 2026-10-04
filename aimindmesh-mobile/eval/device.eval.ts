/**
 * The eval scenarios on a phone: the app's real code and engine (GenieX on the NPU), driven
 * through DevTools (eval/harness/deviceCdp.ts), scored on the PC like eval/run.eval.ts.
 *   EVAL_DEVICE=serial (required)   EVAL_MODEL=file name or bundle path (required)
 *   EVAL_FILTER, EVAL_SAMPLES, EVAL_THINKING=on|off, EVAL_PERSONA, EVAL_NCTX (default: the phone's auto), EVAL_NAME,
 *   EVAL_PORT (local DevTools port, one per phone run in parallel; default 9300)
 * The phone needs a test build (VITE_AIMM_EVAL=1) with the app open.
 */
import { describe, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { DeviceSession, waitUntilCool } from './harness/deviceCdp';
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

type Profile = { promptTokens: number; generatedTokens: number; ttftMs: number; prefillSpeed: number; decodingSpeed: number; computeUnit?: string };
const sum = (profiles: Profile[] = []) => profiles.reduce((s, p) => ({ p: s.p + p.promptTokens, g: s.g + p.generatedTokens, ttft: s.ttft || p.ttftMs }), { p: 0, g: 0, ttft: 0 });

describe.skipIf(!env.EVAL_DEVICE)('AIMindMesh eval on the phone', () => {
    it(`${scenarios.length} scenarios × ${samples} on ${env.EVAL_DEVICE}`, async () => {
        if (!env.EVAL_DEVICE || !env.EVAL_MODEL) throw new Error('EVAL_DEVICE and EVAL_MODEL are required');
        const device = await DeviceSession.open(env.EVAL_DEVICE, Number(env.EVAL_PORT || 9300));
        const info = await device.call<Record<string, any>>('info');
        console.log('device', JSON.stringify(info));
        const options = {
            modelPath: env.EVAL_MODEL, thinking: (env.EVAL_THINKING || 'on') !== 'off', persona: env.EVAL_PERSONA || 'Atlas',
            ...(env.EVAL_NCTX ? { contextSize: Number(env.EVAL_NCTX) } : {}),
        };
        const records: RunRecord[] = [];
        try {
            for (const scenario of scenarios) {
                for (let sample = 1; sample <= samples; sample++) {
                    await waitUntilCool(env.EVAL_DEVICE);
                    let checks: Check[];
                    let answer: string;
                    let promptTokens = 0, ms = 0;
                    let extra: Record<string, unknown> = {};
                    try {
                        if (scenario.category === 'extraction') {
                            const out = await device.call<any>('extract', scenario, options);
                            checks = scoreFacts(out.saved, scenario.expect, out.now);
                            answer = out.saved.map((f: any) => `[${f.kind}${f.dueAt ? ' ' + new Date(f.dueAt).toISOString().slice(0, 10) : ''}] ${f.content}`).join(' | ') || '(nothing saved)';
                            ms = out.ms; promptTokens = sum(out.profiles).p;
                            extra = { raw: String(out.raw).slice(0, 800), profiles: out.profiles };
                        } else {
                            const out = await device.call<any>('chat', scenario, { ...options, consolidate: !!scenario.expect.remembers });
                            checks = [
                                ...scoreToolCall(out.calls, scenario.expect),
                                ...scoreRemember(out.saved ?? [], out.calls, scenario.expect.remembers),
                                ...(out.calls.length === 0 ? scoreAnswer(out.answer, scenario.expect) : []),
                            ];
                            answer = out.calls.length ? `TOOL ${out.calls.map((c: any) => `${c.name}(${JSON.stringify(c.args)})`).join(', ')}` : out.answer;
                            ms = out.ms; promptTokens = sum(out.profiles).p;
                            extra = {
                                raw: out.raws?.map((r: any) => r.output).join('\n---\n').slice(0, 1200), thinking: String(out.thinking).slice(0, 300),
                                profiles: out.profiles, steps: out.steps, ...(env.EVAL_DUMP ? { prompts: out.raws?.map((r: any) => r.prompt) } : {}),
                            };
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
        } finally {
            device.close();
        }
        const model = env.EVAL_MODEL.split('/').pop()!.replace(/\.gguf$/, '');
        const name = `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}-device-${info?.caps?.npuArch ?? env.EVAL_DEVICE}-${model}-${env.EVAL_NAME || 'run'}`;
        const md = writeReport(name, { device: env.EVAL_DEVICE, soc: info?.caps?.socModel, model, persona: options.persona, thinking: options.thinking, nCtx: options.contextSize ?? 'auto', samples, scenarios: scenarios.length }, records);
        console.log(md.split('## Failures')[0]);
        console.table(summarize(records));
    });
});
