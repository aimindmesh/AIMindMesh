import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
    genie: {
        isLoaded: vi.fn(async () => ({ loaded: true, computeUnit: 'npu' })),
        formatChat: vi.fn(async () => ({ prompt: 'P' })),
        generateStream: vi.fn(),
        abortGeneration: vi.fn(async () => ({ success: true })),
    },
    init: vi.fn(async () => true),
    // 3 W for 2 s while generating, 1 W idle
    running: [{ t: 0, powerMw: 2000, charging: false }, { t: 1000, powerMw: 4000, charging: false }, { t: 2000, powerMw: 2000, charging: false }],
    idle: [{ t: 0, powerMw: 1000, charging: false }, { t: 3000, powerMw: 1000, charging: false }],
}));

vi.mock('genie-capacitor', () => ({ Genie: m.genie }));
vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('../src/services/llm/providers/genieProvider', () => ({ initGenieModel: m.init }));
vi.mock('../src/services/llm/benchmark/powerSampler', () => ({
    samplePowerFor: vi.fn(async () => m.idle),
    startPowerSampling: () => ({ stop: () => m.running }),
}));

import { computeMetrics, integrateEnergy } from '../src/services/llm/benchmark/benchmarkMath';
import {
    benchmarkTargets, configForTarget, loadBenchmarkResults, runBenchmark, saveBenchmarkResults, BenchmarkResult,
} from '../src/services/llm/benchmark/llmBenchmark';
import { buildPrefillText } from '../src/services/llm/benchmark/benchmarkPrompts';
import { resetChatActivity } from '../src/services/llm/background/chatActivity';

const gguf = { model_id: 'q', model_name: 'Qwen3.5-2B-Q4_0', path: '/f/Qwen3.5-2B-Q4_0.gguf', runtime: 'llama_cpp', npuReady: true };
const profile = { ttftMs: 500, promptTokens: 1500, generatedTokens: 64, promptTimeMs: 500, decodeTimeMs: 3000, prefillSpeed: 3000, decodingSpeed: 21, computeUnit: 'npu' };

beforeEach(() => {
    vi.clearAllMocks();
    resetChatActivity();
    localStorage.clear();
    m.genie.isLoaded.mockResolvedValue({ loaded: true, computeUnit: 'npu' });
    m.genie.generateStream.mockImplementation(async (_o: unknown, cb: (r: unknown) => void) => {
        cb({ text: 'x', done: false });
        cb({ text: '', done: true, profile });
        return 'id';
    });
});

describe('benchmark arithmetic', () => {
    it('integrates battery power, not while charging', () => {
        expect(integrateEnergy(m.running)).toMatchObject({ joules: 6, avgW: 3, seconds: 2 });
        expect(integrateEnergy([...m.running, { t: 3000, charging: true }])).toMatchObject({ joules: null, charging: true });
        expect(integrateEnergy([{ t: 0, powerMw: 1, charging: false }]).joules).toBeNull();
    });

    it('counts the energy above idle per 1000 tokens, and derives speeds without a profile', () => {
        const timings = { loadMs: 0, ttftMs: 2000, totalMs: 12000, promptTokens: 900, generatedTokens: 101 };
        expect(computeMetrics(timings, m.running, 1)).toEqual({
            prefillTps: 450, decodeTps: 10, avgW: 3, netJoules: 4, jPer1kTokens: 4, charging: false,
        });
        expect(computeMetrics({ ...timings, prefillTps: 3000, decodeTps: 21 }, [], null)).toMatchObject({ prefillTps: 3000, decodeTps: 21, jPer1kTokens: null });
    });

    it('the long prompt is about 1500 tokens', () => {
        expect(buildPrefillText().length).toBeGreaterThan(5200);
        expect(buildPrefillText().length).toBeLessThan(6500);
    });
});

describe('benchmark targets and results', () => {
    it('measures a GGUF on every GenieX unit and on llama.cpp, bundles only where QAIRT runs', () => {
        const bundle = { model_id: 'b', model_name: 'Qwen3 4B', path: '/f/models/genie/q', runtime: 'qairt' };
        expect(benchmarkTargets([gguf, bundle], false).map(t => t.label)).toEqual([
            'Qwen3.5-2B-Q4_0 · GenieX NPU', 'Qwen3.5-2B-Q4_0 · GenieX GPU', 'Qwen3.5-2B-Q4_0 · GenieX CPU', 'Qwen3.5-2B-Q4_0 · llama.cpp',
        ]);
        expect(benchmarkTargets([{ ...gguf, npuReady: false }], true)).toHaveLength(3);
        expect(benchmarkTargets([bundle], true).map(t => t.id)).toEqual(['genie:qairt:/f/models/genie/q']);
    });

    it('keeps the latest result of each target per SoC, and turns one into the chat model', () => {
        const r = { targetId: 't', workload: 'decode', decodeTps: 10 } as BenchmarkResult;
        saveBenchmarkResults('sm8550', [r]);
        saveBenchmarkResults('sm8550', [{ ...r, decodeTps: 12 }]);
        expect(loadBenchmarkResults('sm8550').map(x => x.decodeTps)).toEqual([12]);
        expect(loadBenchmarkResults('sm8750')).toEqual([]);
        expect(configForTarget({} as any, { engine: 'genie', modelPath: gguf.path, runtime: 'npu' }))
            .toEqual({ provider: 'genie-npu', engine: 'genie', nativeModelPath: gguf.path, genieRuntime: 'npu' });
    });
});

describe('running the benchmark', () => {
    it('uses the GenieX profile and the battery samples', async () => {
        const [target] = benchmarkTargets([gguf], false);
        const results = await runBenchmark([target], ['prefill'], {} as any, () => {});
        expect(m.init).toHaveBeenCalledWith(gguf.path, { genieRuntime: 'npu', contextSize: 4096 });
        expect(m.genie.generateStream).toHaveBeenCalledTimes(2); // warm-up + measure
        expect(results![0]).toMatchObject({
            computeUnit: 'npu', promptTokens: 1500, generatedTokens: 64, prefillTps: 3000, decodeTps: 21,
            baselineW: 1, avgW: 3, netJoules: 4, jPer1kTokens: 2.6, estimatedTokens: false,
        });
    });

    it('reports a unit that did not take the model instead of mislabeling it', async () => {
        m.genie.isLoaded.mockResolvedValue({ loaded: true, computeUnit: 'cpu' });
        const [target] = benchmarkTargets([gguf], false);
        const results = await runBenchmark([target], ['decode'], {} as any, () => {});
        expect(results![0].error).toBe('Runs on cpu instead of npu');
    });
});
