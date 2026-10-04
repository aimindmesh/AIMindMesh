/**
 * On-device LLM benchmark: the same workloads on each engine/unit the phone offers, measuring
 * speed (GenieX profile, JS timings for llama.cpp) and battery energy, so the chat and the
 * background work can be put where they cost least. Started by the user from the settings; it
 * runs as a background task, so the chat stops it (arbiter).
 */
import { Genie, GenieModelInfo, GenieRuntime } from 'genie-capacitor';
import type { LLMConfig } from '../../../types';
import { logger } from '../../logger';
import { runExclusiveBackground } from '../background/llmArbiter';
import { initGenieModel } from '../providers/genieProvider';
import { formatBundlePrompt, isGgufPath } from '../providers/genieSupport';
import { baselineWatts, computeMetrics, estimateTokens, PowerReading, RunMetrics, RunTimings } from './benchmarkMath';
import { samplePowerFor, startPowerSampling } from './powerSampler';
import { buildPrefillText, DECODE_REQUEST, PREFILL_REQUEST } from './benchmarkPrompts';

export const BENCH_CONTEXT = 4096;
const BASELINE_MS = 3000;

export type WorkloadId = 'prefill' | 'decode';

/** prefill: a long prompt like the memory consolidation; decode: a short prompt, a long answer */
export const WORKLOADS: Record<WorkloadId, { label: string; maxTokens: number; user: () => string }> = {
    prefill: { label: 'Long prompt (~1500 tok)', maxTokens: 64, user: () => `${buildPrefillText()}\n\n${PREFILL_REQUEST}` },
    decode: { label: 'Long answer (256 tok)', maxTokens: 256, user: () => DECODE_REQUEST },
};

export interface BenchmarkTarget {
    id: string;
    label: string;
    engine: 'genie' | 'gguf';
    modelPath: string;
    /** GenieX compute unit (GGUF files) */
    runtime?: GenieRuntime;
}

export interface BenchmarkResult extends Omit<RunTimings, 'prefillTps' | 'decodeTps'>, RunMetrics {
    targetId: string;
    label: string;
    engine: BenchmarkTarget['engine'];
    modelPath: string;
    runtime?: GenieRuntime;
    workload: WorkloadId;
    baselineW: number | null;
    at: number;
    error?: string;
}

const fileName = (path: string) => path.split('/').pop() || path;

/** What can be measured: every GGUF on GenieX NPU/GPU/CPU and on llama.cpp, QAIRT bundles where supported */
export function benchmarkTargets(models: GenieModelInfo[], qairtSupported: boolean): BenchmarkTarget[] {
    const targets: BenchmarkTarget[] = [];
    for (const model of models) {
        const name = model.model_name || fileName(model.path);
        if (model.runtime === 'llama_cpp') {
            const units: GenieRuntime[] = model.npuReady ? ['npu', 'gpu', 'cpu'] : ['gpu', 'cpu'];
            for (const unit of units) {
                targets.push({ id: `genie:${unit}:${model.path}`, label: `${name} · GenieX ${unit.toUpperCase()}`, engine: 'genie', modelPath: model.path, runtime: unit });
            }
            targets.push({ id: `gguf:${model.path}`, label: `${name} · llama.cpp`, engine: 'gguf', modelPath: model.path });
        } else if (qairtSupported) {
            targets.push({ id: `genie:qairt:${model.path}`, label: `${name} · GenieX QAIRT`, engine: 'genie', modelPath: model.path, runtime: 'npu' });
        }
    }
    return targets;
}

/** A nonce first in the system prompt: the engines' prefix reuse must not skip the measured prompt */
const systemPrompt = (nonce: string) => `Run ${nonce}. You are a concise personal assistant.`;

async function genieGenerate(target: BenchmarkTarget, system: string, user: string, maxTokens: number, signal: AbortSignal) {
    const formatted = isGgufPath(target.modelPath)
        ? { prompt: (await Genie.formatChat({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }], enableThinking: false })).prompt, stopSequences: undefined }
        : formatBundlePrompt(target.modelPath, system, [{ id: 'b', role: 'user', text: user, timestamp: new Date() }], 'Assistant');
    const start = performance.now();
    let first: number | null = null;
    let chunks = 0;
    const onAbort = () => { void Genie.abortGeneration(); };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
        return await new Promise<{ ttftMs: number; totalMs: number; chunks: number; profile?: import('genie-capacitor').GenieProfile }>((resolve, reject) => {
            Genie.generateStream({ prompt: formatted.prompt, maxTokens, temperature: 0.7, topP: 0.9, stopSequences: formatted.stopSequences }, (result, err) => {
                if (err || result?.error) return reject(new Error(err?.message || result?.error));
                if (result?.text) {
                    chunks++;
                    if (first === null) first = performance.now() - start;
                }
                if (result?.done) resolve({ ttftMs: first ?? performance.now() - start, totalMs: performance.now() - start, chunks, profile: result.profile });
            }).catch(reject);
        });
    } finally {
        signal.removeEventListener('abort', onAbort);
    }
}

/** Runs `fn` while sampling the battery power; the sampler stops also when `fn` fails */
async function measured<T>(fn: () => Promise<T>): Promise<{ value: T; samples: PowerReading[] }> {
    const sampler = startPowerSampling();
    try {
        const value = await fn();
        return { value, samples: sampler.stop() };
    } finally {
        sampler.stop();
    }
}

async function runGenie(target: BenchmarkTarget, workload: WorkloadId, signal: AbortSignal) {
    const loadStart = performance.now();
    const config = { genieRuntime: target.runtime ?? 'auto', contextSize: BENCH_CONTEXT } as LLMConfig;
    if (!(await initGenieModel(target.modelPath, config))) throw new Error('The model did not load');
    const loadMs = performance.now() - loadStart;
    const unit = (await Genie.isLoaded()).computeUnit;
    if (target.runtime && target.runtime !== 'auto' && isGgufPath(target.modelPath) && unit !== target.runtime) {
        throw new Error(`Runs on ${unit} instead of ${target.runtime}`);
    }
    await genieGenerate(target, systemPrompt(`warm-${Date.now()}`), 'Say hello.', 8, signal);

    const w = WORKLOADS[workload];
    const { value: run, samples } = await measured(() => genieGenerate(target, systemPrompt(String(Date.now())), w.user(), w.maxTokens, signal));
    const p = run.profile;
    const timings: RunTimings = {
        loadMs, computeUnit: p?.computeUnit ?? unit,
        ttftMs: p?.ttftMs ?? run.ttftMs, totalMs: run.totalMs,
        promptTokens: p?.promptTokens ?? estimateTokens(w.user()), generatedTokens: p?.generatedTokens ?? run.chunks,
        prefillTps: p?.prefillSpeed, decodeTps: p?.decodingSpeed, estimatedTokens: !p,
    };
    return { timings, samples };
}

async function runLlamaCpp(target: BenchmarkTarget, workload: WorkloadId, signal: AbortSignal, config: LLMConfig) {
    const nativeLLM = await import('../nativeLLM');
    const loadStart = performance.now();
    await nativeLLM.initNativeModel({
        modelPath: target.modelPath, nCtx: BENCH_CONTEXT, nThreads: config.nThreads, nThreadsBatch: config.nThreadsBatch,
        nGpuLayers: config.nGpuLayers, useOpenCL: config.useOpenCL, useVulkan: config.useVulkan,
    }, 'chat');
    const loadMs = performance.now() - loadStart;
    const generate = async (system: string, user: string, maxTokens: number) => {
        const start = performance.now();
        let first: number | null = null;
        let chunks = 0;
        for await (const piece of nativeLLM.generateNativeStream({
            messages: [{ role: 'system', content: system }, { role: 'user', content: user }], maxTokens, temperature: 0.7, signal,
        }, 'chat')) {
            if (!piece) continue;
            chunks++;
            if (first === null) first = performance.now() - start;
        }
        return { ttftMs: first ?? performance.now() - start, totalMs: performance.now() - start, chunks };
    };
    await generate(systemPrompt(`warm-${Date.now()}`), 'Say hello.', 8);

    const w = WORKLOADS[workload];
    const user = w.user();
    const { value: run, samples } = await measured(() => generate(systemPrompt(String(Date.now())), user, w.maxTokens));
    const timings: RunTimings = {
        loadMs, computeUnit: config.useOpenCL || config.useVulkan ? 'gpu' : 'cpu', ttftMs: run.ttftMs, totalMs: run.totalMs,
        promptTokens: estimateTokens(systemPrompt('0') + user), generatedTokens: run.chunks, estimatedTokens: true,
    };
    return { timings, samples };
}

export interface BenchmarkProgress {
    step: string;
    done: number;
    total: number;
    result?: BenchmarkResult;
}

/**
 * Runs each target on each workload. Returns null when the model is busy (chat or another
 * background task); stops early when the chat needs the model.
 */
export async function runBenchmark(
    targets: BenchmarkTarget[],
    workloads: WorkloadId[],
    config: LLMConfig,
    onProgress: (progress: BenchmarkProgress) => void
): Promise<BenchmarkResult[] | null> {
    return runExclusiveBackground('llm-benchmark', async signal => {
        const results: BenchmarkResult[] = [];
        const total = targets.length * workloads.length;
        onProgress({ step: 'Measuring idle power…', done: 0, total });
        const baselineW = baselineWatts(await samplePowerFor(BASELINE_MS));
        for (const target of targets) {
            for (const workload of workloads) {
                if (signal.aborted) return results;
                onProgress({ step: `${target.label}: ${WORKLOADS[workload].label}`, done: results.length, total });
                const base = { targetId: target.id, label: target.label, engine: target.engine, modelPath: target.modelPath, runtime: target.runtime, workload, baselineW, at: Date.now() };
                let result: BenchmarkResult;
                try {
                    const { timings, samples } = target.engine === 'genie'
                        ? await runGenie(target, workload, signal)
                        : await runLlamaCpp(target, workload, signal, config);
                    result = { ...base, ...timings, ...computeMetrics(timings, samples, baselineW) };
                } catch (e: any) {
                    if (signal.aborted) return results;
                    logger.log('warn', `[LLMBenchmark] ${target.label} (${workload}) failed`, e);
                    result = {
                        ...base, loadMs: 0, ttftMs: 0, totalMs: 0, promptTokens: 0, generatedTokens: 0,
                        prefillTps: 0, decodeTps: 0, avgW: null, netJoules: null, jPer1kTokens: null, charging: false, error: e?.message || String(e),
                    };
                }
                results.push(result);
                logger.log('info', `[LLMBenchmark] ${target.label} (${workload}): ${JSON.stringify(result)}`);
                onProgress({ step: target.label, done: results.length, total, result });
            }
        }
        return results;
    }, 'genie-npu');
}

// ─── Saved results, per SoC ──────────────────────────────────────────────────

const STORAGE_KEY = 'llm-benchmark-results';

export function loadBenchmarkResults(soc: string): BenchmarkResult[] {
    try {
        const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, BenchmarkResult[]>;
        return all[soc] || [];
    } catch {
        return [];
    }
}

/** Keeps the latest result of each target and workload */
export function saveBenchmarkResults(soc: string, results: BenchmarkResult[]): BenchmarkResult[] {
    let all: Record<string, BenchmarkResult[]> = {};
    try { all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { /* start over */ }
    const merged = new Map((all[soc] || []).map(r => [`${r.targetId}|${r.workload}`, r]));
    for (const r of results) merged.set(`${r.targetId}|${r.workload}`, r);
    all[soc] = [...merged.values()];
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all)); } catch { /* storage full: shown, not saved */ }
    return all[soc];
}

/** The configuration that makes a measured target the chat model */
export function configForTarget(config: LLMConfig, target: Pick<BenchmarkResult, 'engine' | 'modelPath' | 'runtime'>): LLMConfig {
    return target.engine === 'genie'
        ? { ...config, provider: 'genie-npu', engine: 'genie', nativeModelPath: target.modelPath, genieRuntime: target.runtime ?? 'auto' }
        : { ...config, provider: 'native-gguf', engine: 'gguf', nativeModelPath: target.modelPath };
}
