import React, { useEffect, useMemo, useState } from 'react';
import { Genie, GenieCapabilities, GenieModelInfo } from 'genie-capacitor';
import { LLMConfig } from '../../../types';
import {
    BenchmarkProgress, BenchmarkResult, WORKLOADS, WorkloadId, benchmarkTargets, configForTarget,
    loadBenchmarkResults, runBenchmark, saveBenchmarkResults,
} from '../../../services/llm/benchmark/llmBenchmark';

interface LlmBenchmarkPanelProps {
    llmConfig: LLMConfig;
    onLlmConfigSave: (config: LLMConfig) => void;
    triggerHaptic: () => void;
}

const Metric: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div className="bg-surface/40 p-1.5 rounded-lg">
        <span className="text-text-tertiary block text-[9px] uppercase">{label}</span>
        <span className="text-text-primary font-semibold text-[11px]">{value}</span>
    </div>
);

const ResultCard: React.FC<{ result: BenchmarkResult; active: boolean; onUse: () => void }> = ({ result: r, active, onUse }) => {
    const approx = r.estimatedTokens ? '~' : '';
    return (
        <div className={`p-2.5 rounded-xl border ${active ? 'border-amber-500/50 bg-amber-500/10' : 'border-white/5 bg-surface/40'}`}>
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <p className="text-xs font-medium text-text-primary truncate">{r.label}</p>
                    <p className="text-[10px] text-text-tertiary">
                        {WORKLOADS[r.workload].label}{r.computeUnit ? ` · ran on ${r.computeUnit.toUpperCase()}` : ''} · {new Date(r.at).toLocaleDateString()}
                    </p>
                </div>
                {!r.error && (
                    <button onClick={onUse} disabled={active} className="text-[11px] px-2 py-1 rounded-lg border border-white/10 text-text-primary shrink-0">
                        {active ? 'In use' : 'Use this'}
                    </button>
                )}
            </div>
            {r.error ? (
                <p className="text-[11px] text-red-300 mt-1.5">{r.error}</p>
            ) : (
                <div className="grid grid-cols-3 gap-1.5 mt-2">
                    <Metric label="First token" value={`${Math.round(r.ttftMs)} ms`} />
                    <Metric label="Prompt" value={`${approx}${r.prefillTps} tok/s`} />
                    <Metric label="Answer" value={`${r.decodeTps} tok/s`} />
                    <Metric label="Load" value={`${(r.loadMs / 1000).toFixed(1)} s`} />
                    <Metric label="Power" value={r.avgW === null ? '—' : `${r.avgW} W`} />
                    <Metric label="J / 1k tok" value={r.jPer1kTokens === null ? (r.charging ? 'charging' : '—') : `${approx}${r.jPer1kTokens}`} />
                </div>
            )}
        </div>
    );
};

/**
 * Measures the engines and units on the same workloads (speed, battery energy) and lets the user
 * make the best one the chat model; background memory work uses the same model.
 */
const LlmBenchmarkPanel: React.FC<LlmBenchmarkPanelProps> = ({ llmConfig, onLlmConfigSave, triggerHaptic }) => {
    const [open, setOpen] = useState(false);
    const [caps, setCaps] = useState<GenieCapabilities | null>(null);
    const [models, setModels] = useState<GenieModelInfo[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [workloads, setWorkloads] = useState<Set<WorkloadId>>(new Set(['prefill', 'decode']));
    const [progress, setProgress] = useState<BenchmarkProgress | null>(null);
    const [results, setResults] = useState<BenchmarkResult[]>([]);
    const soc = caps?.socModel || 'unknown';

    useEffect(() => {
        if (!open) return;
        (async () => {
            try {
                const [c, list] = await Promise.all([Genie.getCapabilities(), Genie.listLocalModels()]);
                setCaps(c);
                setModels(list.models || []);
                setResults(loadBenchmarkResults(c.socModel || 'unknown'));
            } catch {
                // Not available on this platform
            }
        })();
    }, [open]);

    const targets = useMemo(() => benchmarkTargets(models, !!caps?.qairtSupported), [models, caps]);
    const toggle = <T,>(set: Set<T>, value: T) => {
        const next = new Set(set);
        if (next.has(value)) next.delete(value); else next.add(value);
        return next;
    };

    const run = async () => {
        triggerHaptic();
        const chosen = targets.filter(t => selected.has(t.id));
        const done = await runBenchmark(chosen, [...workloads], llmConfig, setProgress);
        setProgress(null);
        if (done === null) {
            alert('The model is busy (chat or memory work): try again in a moment.');
            return;
        }
        setResults(saveBenchmarkResults(soc, done));
    };

    const isActive = (r: BenchmarkResult) => llmConfig.nativeModelPath === r.modelPath && (r.engine === 'genie'
        ? llmConfig.provider === 'genie-npu' && (llmConfig.genieRuntime ?? 'auto') === (r.runtime ?? 'auto')
        : llmConfig.provider !== 'genie-npu' && (llmConfig.engine ?? 'gguf') === 'gguf');
    const charging = results.some(r => r.charging);

    return (
        <div className="border-t border-white/5 pt-3">
            <button onClick={() => { triggerHaptic(); setOpen(!open); }} className="w-full flex items-center justify-between text-sm font-semibold text-text-primary">
                <span>📊 Speed &amp; battery benchmark</span>
                <span className="text-text-tertiary">{open ? '▾' : '▸'}</span>
            </button>
            {open && (
                <div className="space-y-3 mt-3">
                    <p className="text-[11px] text-text-tertiary">
                        Runs the same prompts on each engine and unit. Unplug the phone to measure energy: J/1k tok is the battery energy
                        above idle for 1000 tokens (prompt + answer). Close other apps and keep the screen on; the chat stops the benchmark.
                    </p>
                    {targets.length === 0 ? (
                        <p className="text-xs text-text-secondary">No GGUF model or AI Hub bundle on this phone: download one in the Genie NPU settings.</p>
                    ) : (
                        <div className="space-y-1.5 max-h-56 overflow-y-auto">
                            {targets.map(t => (
                                <label key={t.id} className="flex items-center gap-2 text-xs text-text-secondary">
                                    <input type="checkbox" checked={selected.has(t.id)} onChange={() => setSelected(toggle(selected, t.id))} disabled={!!progress} />
                                    <span className="truncate">{t.label}</span>
                                </label>
                            ))}
                        </div>
                    )}
                    <div className="flex flex-wrap gap-3">
                        {(Object.keys(WORKLOADS) as WorkloadId[]).map(id => (
                            <label key={id} className="flex items-center gap-1.5 text-xs text-text-secondary">
                                <input type="checkbox" checked={workloads.has(id)} onChange={() => setWorkloads(toggle(workloads, id))} disabled={!!progress} />
                                {WORKLOADS[id].label}
                            </label>
                        ))}
                    </div>
                    <button
                        onClick={run}
                        disabled={!!progress || selected.size === 0 || workloads.size === 0}
                        className="w-full py-2 rounded-lg text-sm font-medium bg-amber-500/20 border border-amber-500/30 text-amber-300 disabled:opacity-50"
                    >
                        {progress ? `${progress.done}/${progress.total} · ${progress.step}` : 'Run benchmark'}
                    </button>
                    {charging && <p className="text-[11px] text-amber-300">Some runs were done while charging: their energy is not measured.</p>}
                    {results.length > 0 && (
                        <div className="space-y-2">
                            <span className="text-[11px] text-text-secondary">Results on {soc.toUpperCase()}</span>
                            {[...results].sort((a, b) => a.workload.localeCompare(b.workload) || (a.jPer1kTokens ?? Infinity) - (b.jPer1kTokens ?? Infinity)).map(r => (
                                <ResultCard
                                    key={`${r.targetId}|${r.workload}`}
                                    result={r}
                                    active={isActive(r)}
                                    onUse={() => { triggerHaptic(); onLlmConfigSave(configForTarget(llmConfig, r)); }}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default LlmBenchmarkPanel;
