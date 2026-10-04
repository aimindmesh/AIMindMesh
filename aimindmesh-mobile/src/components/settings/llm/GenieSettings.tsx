import React, { useState } from 'react';
import { LLMConfig } from '../../../types';
import type { GenieModelInfo, GenieRuntime } from 'genie-capacitor';
import { useGenieModels } from '../../../hooks/useGenieModels';
import { initGenieModel, unloadGenieModel } from '../../../services/llm/providers/genieProvider';
import { genieRuntime } from '../../../services/llm/providers/genieSupport';
import { formatGenieProfile } from '../../../services/llm/npuStats';
import GenieGgufSection from './GenieGgufSection';
import GenieQairtSection from './GenieQairtSection';

interface GenieSettingsProps {
    llmConfig: LLMConfig;
    onLlmConfigSave: (config: LLMConfig) => void;
    triggerHaptic: () => void;
    hfToken: string;
    downloadedGenieModels: GenieModelInfo[];
    setDownloadedGenieModels: (models: GenieModelInfo[]) => void;
    isImporting: boolean;
    handleImportGenieZipFile: () => Promise<void>;
}

const Chip: React.FC<{ ok: boolean; label: string }> = ({ ok, label }) => (
    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${ok
        ? 'bg-green-500/15 text-green-300 border-green-500/30'
        : 'bg-white/5 text-text-tertiary border-white/10'}`}>
        {ok ? '✓' : '✗'} {label}
    </span>
);

const GenieSettings: React.FC<GenieSettingsProps> = ({
    llmConfig,
    onLlmConfigSave,
    triggerHaptic,
    hfToken,
    downloadedGenieModels,
    setDownloadedGenieModels,
    isImporting,
    handleImportGenieZipFile
}) => {
    const genie = useGenieModels(setDownloadedGenieModels, hfToken);
    const [busy, setBusy] = useState(false);
    const runtime = genieRuntime(llmConfig);
    const ggufModels = downloadedGenieModels.filter(m => m.runtime === 'llama_cpp');
    const bundles = downloadedGenieModels.filter(m => m.runtime !== 'llama_cpp');
    const caps = genie.capabilities;
    const { status, profile } = genie;
    const currentModel = downloadedGenieModels.find(m => m.path === llmConfig.nativeModelPath);

    /** Loads through the provider, so the model orchestrator first frees the other LLM engines */
    const load = async (model: GenieModelInfo, config: LLMConfig = llmConfig) => {
        triggerHaptic();
        setBusy(true);
        try {
            const next: LLMConfig = {
                ...config,
                provider: 'genie-npu',
                engine: 'genie',
                nativeModelPath: model.path,
                enableVision: model.is_vision || config.enableVision
            };
            if (await initGenieModel(model.path, next)) onLlmConfigSave(next);
            else alert(`Failed to load ${model.model_name}`);
            await genie.refresh();
        } finally {
            setBusy(false);
        }
    };

    const changeRuntime = async (value: GenieRuntime) => {
        triggerHaptic();
        const next = { ...llmConfig, genieRuntime: value };
        onLlmConfigSave(next);
        // Reload the active GGUF on the new unit now, so the card shows where it really runs
        if (currentModel?.runtime === 'llama_cpp' && status.loaded) await load(currentModel, next);
    };

    const unload = async () => {
        triggerHaptic();
        await unloadGenieModel();
        onLlmConfigSave({ ...llmConfig, nativeModelPath: undefined });
        await genie.refresh();
    };

    const remove = async (model: GenieModelInfo) => {
        if (!confirm(`Delete ${model.model_name || model.model_id}?`)) return;
        triggerHaptic();
        await genie.remove(model);
    };

    const loadedModel = downloadedGenieModels.find(m => m.path === status.modelPath);
    // Auto starts K-quants (no NPU kernels) on the GPU on purpose: only a real fallback is worth a warning
    const fellBack = status.loaded && status.runtime === 'llama_cpp' && runtime === 'auto' && status.computeUnit !== 'npu' && loadedModel?.npuReady !== false;
    const noNpuKernels = status.loaded && status.runtime === 'llama_cpp' && loadedModel?.npuReady === false;

    return (
        <div className="space-y-4 animate-fade-in">
            {/* What this phone supports */}
            <div className="bg-amber-500/10 p-4 rounded-xl border border-amber-500/30">
                <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-lg bg-amber-500/20 text-amber-300">
                        <span className="text-xl">⚡</span>
                    </div>
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-text-primary">Qualcomm GenieX</p>
                        <p className="text-xs text-text-secondary truncate">
                            {caps ? (caps.hasNpu ? `${caps.socModel?.toUpperCase()} · Hexagon ${caps.npuArch}` : 'No Hexagon NPU on this device') : 'Checking the NPU…'}
                        </p>
                    </div>
                </div>
                {caps && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                        <Chip ok={!!caps.ggufNpuSupported} label="GGUF on the NPU" />
                        <Chip ok={!!caps.qairtSupported} label="AI Hub bundles" />
                    </div>
                )}
                {profile && (
                    <p className="text-[11px] text-text-secondary mt-3 pt-3 border-t border-white/5">
                        Last answer ({profile.model}): {formatGenieProfile(profile)}
                    </p>
                )}
            </div>

            {/* Loaded model */}
            <div className="border-t border-white/5 pt-2">
                <h5 className="text-sm font-semibold text-text-primary mb-3">Active model</h5>
                {status.loaded || llmConfig.nativeModelPath ? (
                    <div className="p-3.5 bg-surface rounded-xl border border-amber-500/30 flex items-center justify-between">
                        <div className="flex-1 overflow-hidden mr-2">
                            <div className="flex items-center gap-2">
                                <div className={`w-2.5 h-2.5 rounded-full ${status.loaded ? 'bg-amber-400 animate-pulse' : 'bg-white/20'}`}></div>
                                <p className="text-sm font-semibold text-text-primary truncate">
                                    {status.modelName || llmConfig.nativeModelPath?.split('/').pop()}
                                </p>
                            </div>
                            <p className="text-xs text-text-secondary mt-0.5 ml-4.5">
                                {status.loaded
                                    ? `Running on ${(status.computeUnit || 'npu').toUpperCase()} · ${status.runtime === 'llama_cpp' ? `GGUF, ${status.contextLength ?? ''} tokens of context` : 'AI Hub bundle'}`
                                    : 'Loads with the first message'}
                            </p>
                            {fellBack && (
                                <p className="text-[11px] text-amber-300 mt-1 ml-4.5">
                                    The NPU did not take this model: it runs on the {status.computeUnit?.toUpperCase()} (see the log).
                                </p>
                            )}
                            {noNpuKernels && (
                                <p className="text-[11px] text-text-tertiary mt-1 ml-4.5">
                                    {loadedModel?.precision} weights have no NPU kernels: for the NPU use a Q4_0 file.
                                </p>
                            )}
                        </div>
                        <button
                            onClick={unload}
                            disabled={busy}
                            className="text-xs text-red-400 hover:text-red-300 px-3 py-1.5 bg-red-500/10 rounded-lg border border-red-500/20 font-medium"
                        >
                            Unload
                        </button>
                    </div>
                ) : (
                    <p className="text-sm text-text-secondary italic">No model loaded</p>
                )}
                {busy && <p className="text-[11px] text-amber-300 mt-2">Loading the model…</p>}
            </div>

            <GenieGgufSection
                models={ggufModels}
                currentPath={llmConfig.nativeModelPath}
                runtime={runtime}
                busy={busy}
                progress={genie.progress}
                onRuntimeChange={changeRuntime}
                onLoad={model => load(model)}
                onDelete={remove}
                onDownload={model => { triggerHaptic(); void genie.download(model); }}
                onCancel={model => { triggerHaptic(); void genie.cancel(model); }}
            />

            <GenieQairtSection
                supported={!!caps?.qairtSupported}
                models={bundles}
                currentPath={llmConfig.nativeModelPath}
                busy={busy}
                isImporting={isImporting}
                onImport={handleImportGenieZipFile}
                onLoad={model => load(model)}
            />
        </div>
    );
};

export default GenieSettings;
