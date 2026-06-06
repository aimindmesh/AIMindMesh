import React from 'react';
import { LLMConfig } from '../../../types';
import { ModelDownloadProgress, downloadModel } from '../../../services/model/modelDownloader';
import { getCleanModelName } from '../../../utils/stringUtils';

interface LiteRTSettingsProps {
    llmConfig: LLMConfig;
    onLlmConfigSave: (config: LLMConfig) => void;
    hfToken: string;
    triggerHaptic: () => void;
    downloadProgress: Record<string, ModelDownloadProgress>;
    setDownloadProgress: React.Dispatch<React.SetStateAction<Record<string, ModelDownloadProgress>>>;
    downloadedLiteRTModels: string[];
    setDownloadedLiteRTModels: React.Dispatch<React.SetStateAction<string[]>>;
    externalLiteRTModels: string[];
    isImporting: boolean;
    handleDeleteLiteRTModel: (filename: string) => Promise<void>;
    handleDeleteExternalLiteRTModel: (path: string) => void;
    handleImportLiteRTFile: () => Promise<void>;
}

const LiteRTSettings: React.FC<LiteRTSettingsProps> = ({
    llmConfig,
    onLlmConfigSave,
    hfToken,
    triggerHaptic,
    downloadProgress,
    setDownloadProgress,
    downloadedLiteRTModels,
    setDownloadedLiteRTModels,
    externalLiteRTModels,
    isImporting,
    handleDeleteLiteRTModel,
    handleDeleteExternalLiteRTModel,
    handleImportLiteRTFile
}) => {
    return (
        <div className="mb-4 pt-4 border-t border-white/5">
            <label className="block text-sm font-medium text-text-primary mb-2">
                🚀 Accelerator Backend
            </label>
            <div className="grid grid-cols-2 gap-2">
                <button
                    type="button"
                    onClick={() => { triggerHaptic(); onLlmConfigSave({ ...llmConfig, liteRTBackend: 'CPU' }); }}
                    className={`py-2 px-3 rounded-lg border transition-all flex items-center justify-center gap-2
            ${(llmConfig.liteRTBackend || 'CPU') === 'CPU'
                            ? 'bg-blue-500/20 border-blue-400 text-blue-300'
                            : 'bg-surface border-white/10 text-text-secondary hover:border-white/20'}`}
                >
                    <span className="text-sm font-medium">CPU (Stable)</span>
                </button>
                <button
                    type="button"
                    onClick={() => { triggerHaptic(); onLlmConfigSave({ ...llmConfig, liteRTBackend: 'GPU' }); }}
                    className={`py-2 px-3 rounded-lg border transition-all flex items-center justify-center gap-2
            ${llmConfig.liteRTBackend === 'GPU'
                            ? 'bg-purple-500/20 border-purple-400 text-purple-300'
                            : 'bg-surface border-white/10 text-text-secondary hover:border-white/20'}`}
                >
                    <span className="text-sm font-medium">GPU (Fast)</span>
                </button>
            </div>
            <p className="text-xs text-text-secondary mt-2">
                Use <strong>CPU</strong> if you experience crashes or instability. <strong>GPU</strong> is faster but may be unstable on some devices (e.g. Adreno drivers).
            </p>

            {/* NPU / QNN Delegate Toggle (Qualcomm only) */}
            <div className="mt-4 pt-4 border-t border-white/5">
                <label className="flex items-start gap-3 cursor-pointer group">
                    <div className="relative flex items-center">
                        <input
                            type="checkbox"
                            id="litert-use-npu"
                            checked={llmConfig.liteRTUseNPU ?? false}
                            onChange={(e) => {
                                triggerHaptic();
                                onLlmConfigSave({
                                    ...llmConfig,
                                    liteRTUseNPU: e.target.checked,
                                    // QNN delegate requires CPU context as base
                                    liteRTBackend: e.target.checked ? 'CPU' : llmConfig.liteRTBackend,
                                });
                            }}
                            className="peer h-5 w-5 rounded border-white/10 bg-surface text-purple-500 focus:ring-purple-500/20 focus:ring-offset-0"
                        />
                    </div>
                    <div>
                        <span className="block text-sm font-medium text-text-primary group-hover:text-purple-400 transition-colors">
                            🧠 Use NPU (Hexagon QNN Delegate)
                        </span>
                        <p className="text-xs text-text-secondary mt-1">
                            Offloads inference to the Qualcomm Hexagon NPU via the QNN delegate. Significant performance boost on Snapdragon 8 Gen 2+ devices (Z Fold 5, Z Fold 7).
                            <br />
                            <span className="text-purple-400/80">⚠ Requires Qualcomm Snapdragon SoC. Auto-sets backend to CPU. Reload model after changing.</span>
                        </p>
                    </div>
                </label>
            </div>

            {/* Multi-Token Prediction (MTP) Toggle */}
            <div className="mt-4 pt-4 border-t border-white/5">
                <label className="flex items-start gap-3 cursor-pointer group">
                    <div className="relative flex items-center">
                        <input
                            type="checkbox"
                            id="litert-enable-mtp"
                            checked={llmConfig.liteRTEnableMtp ?? true}
                            onChange={(e) => {
                                triggerHaptic();
                                onLlmConfigSave({
                                    ...llmConfig,
                                    liteRTEnableMtp: e.target.checked,
                                });
                            }}
                            className="peer h-5 w-5 rounded border-white/10 bg-surface text-blue-500 focus:ring-blue-500/20 focus:ring-offset-0"
                        />
                    </div>
                    <div>
                        <span className="block text-sm font-medium text-text-primary group-hover:text-blue-400 transition-colors">
                            ⚡ Multi-Token Prediction (MTP)
                        </span>
                        <p className="text-xs text-text-secondary mt-1">
                            Enables speculative decoding using MTP. Significant speedup on compatible models (Gemma 4).
                            <br />
                            <span className="text-blue-400/80">Turn OFF if you experience hallucinations or gibberish output. Reload model after changing.</span>
                        </p>
                    </div>
                </label>
            </div>

            {/* Session Persistence (KV Cache) Toggle */}
            <div className="mt-4 pt-4 border-t border-white/5">
                <label className="flex items-start gap-3 cursor-pointer group">
                    <div className="relative flex items-center">
                        <input
                            type="checkbox"
                            id="litert-restore-kv"
                            checked={llmConfig.restoreKvCache ?? false}
                            onChange={(e) => {
                                triggerHaptic();
                                onLlmConfigSave({
                                    ...llmConfig,
                                    restoreKvCache: e.target.checked,
                                });
                            }}
                            className="peer h-5 w-5 rounded border-white/10 bg-surface text-green-500 focus:ring-green-500/20 focus:ring-offset-0"
                        />
                    </div>
                    <div>
                        <span className="block text-sm font-medium text-text-primary group-hover:text-green-400 transition-colors">
                            💾 Restore Session (KV Cache)
                        </span>
                        <p className="text-xs text-text-secondary mt-1">
                            Saves and restores conversation history to disk so the model remembers previous turns across app restarts.
                            <br />
                            <span className="text-green-400/80">Can be very slow for long conversations on LiteRT as it re-evaluates all history. Keep off if generation is slow.</span>
                        </p>
                    </div>
                </label>
            </div>

            {/* Context Window */}
            <div className="mt-4 pt-4 border-t border-white/5">
                <label className="block text-sm font-medium text-text-primary mb-1">
                    📐 Context Window (nCtx)
                    <span className="ml-2 text-primary font-bold">{llmConfig.nCtx ?? 4096}</span>
                </label>
                <input
                    type="range"
                    id="litert-nctx"
                    min={512}
                    max={32768}
                    step={512}
                    value={llmConfig.nCtx ?? 4096}
                    onChange={(e) => {
                        triggerHaptic();
                        onLlmConfigSave({ ...llmConfig, nCtx: parseInt(e.target.value) });
                    }}
                    className="w-full accent-blue-500"
                />
                <div className="flex justify-between text-xs text-text-secondary mt-1">
                    <span>512</span>
                    <span>32 768</span>
                </div>
                <p className="text-xs text-text-secondary mt-1">
                    Larger context = more conversation history remembered, but higher RAM usage. Reload model after changing.
                </p>
            </div>

            {/* LiteRT Models Section */}
            <div className="border-t border-white/5 pt-4 mt-4">
                <div className="flex items-center justify-between mb-3">
                    <h5 className="text-sm font-semibold text-text-primary">🏷️ LiteRT Models</h5>
                    <span className="text-xs text-blue-400">Google AI Edge</span>
                </div>

                {/* Active LiteRT Model Card */}
                {llmConfig.liteRTModelPath && (
                    <div className="p-3 bg-surface/40 rounded-lg border border-blue-500/30 mb-3">
                        <div className="flex justify-between items-start">
                            <div className="flex-1 overflow-hidden">
                                <div className="flex items-center gap-2 mb-1">
                                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                                    <p className="text-xs text-text-secondary uppercase tracking-wider font-semibold">Active LiteRT Model</p>
                                </div>
                                <p className="text-sm font-medium text-text-primary mb-1 truncate" title={llmConfig.liteRTModelPath}>
                                    {getCleanModelName(llmConfig.liteRTModelPath)}
                                </p>
                                <p className="text-[10px] text-blue-400">Ready for conversation</p>
                            </div>
                            <button
                                onClick={() => {
                                    triggerHaptic();
                                    onLlmConfigSave({
                                        ...llmConfig,
                                        liteRTModelPath: undefined,
                                        liteRTModelId: undefined
                                    });
                                }}
                                className="ml-2 text-xs text-red-400 hover:text-red-300 px-2 py-1 bg-red-500/10 hover:bg-red-500/20 rounded border border-red-500/20 transition-colors"
                            >
                                Unload
                            </button>
                        </div>
                    </div>
                )}

                {/* Gemma 3n E4B Download Section */}
                <div className={`p-4 rounded-lg border ${llmConfig.liteRTModelId === 'gemma-3n-e4b' ? 'bg-blue-500/10 border-blue-500/40' : 'bg-surface/40 border-white/10'}`}>
                    <div className="flex items-start justify-between">
                        <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-medium text-text-primary">Gemma 3n E4B</span>
                                <span className="text-[10px] px-2 py-0.5 rounded-full border bg-blue-500/20 text-blue-400 border-blue-500/30">Multimodal</span>
                            </div>
                            <p className="text-xs text-text-secondary mb-2">
                                4B effective params. Supports text, images, and audio.
                            </p>
                            <div className="flex items-center gap-3 text-[10px] text-text-tertiary">
                                <span>~2.5GB</span>
                                <span>•</span>
                                <a href="https://huggingface.co/google/gemma-3n-E4B-it-litert-lm" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">
                                    HuggingFace
                                </a>
                            </div>
                        </div>
                        <div className="flex flex-col gap-2">
                            {(llmConfig.liteRTModelPath && llmConfig.liteRTModelId === 'gemma-3n-e4b') ? (
                                <span className="text-xs text-green-400 font-medium px-2 py-1 bg-green-500/10 rounded">Active</span>
                            ) : downloadedLiteRTModels.includes('gemma-3n-E4B-it-int4.litertlm') ? (
                                <button
                                    onClick={() => {
                                        triggerHaptic();
                                        onLlmConfigSave({
                                            ...llmConfig,
                                            liteRTModelId: 'gemma-3n-e4b',
                                            liteRTModelPath: 'gemma-3n-E4B-it-int4.litertlm'
                                        });
                                    }}
                                    className="px-3 py-1.5 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 text-xs rounded-lg transition-colors border border-blue-500/30"
                                >
                                    Load
                                </button>
                            ) : (
                                <button
                                    onClick={async () => {
                                        triggerHaptic();
                                        const url = 'https://huggingface.co/google/gemma-3n-E4B-it-litert-lm/resolve/main/gemma-3n-E4B-it-int4.litertlm';
                                        const filename = 'gemma-3n-E4B-it-int4.litertlm';
                                        try {
                                            await downloadModel(url, filename, (progress) => {
                                                setDownloadProgress(prev => ({
                                                    ...prev,
                                                    ['gemma-3n-e4b']: progress
                                                }));
                                            }, hfToken);
                                            setDownloadedLiteRTModels(prev => [...prev, filename]);
                                        } catch (e) {
                                            alert('Download failed: ' + (e as any).message);
                                        }
                                    }}
                                    disabled={!!downloadProgress['gemma-3n-e4b']}
                                    className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-xs rounded-lg transition-colors disabled:opacity-50"
                                >
                                    {downloadProgress['gemma-3n-e4b']
                                        ? `${Math.round(downloadProgress['gemma-3n-e4b'].percentage)}%`
                                        : 'Download'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Available LiteRT Models List */}
                {downloadedLiteRTModels.filter(f => f !== 'gemma-3n-E4B-it-int4.litertlm').length > 0 && (
                    <div className="mt-4">
                        <h5 className="text-sm font-semibold text-text-primary mb-2">Available Models</h5>
                        <div className="space-y-2">
                            {downloadedLiteRTModels.filter(f => f !== 'gemma-3n-E4B-it-int4.litertlm').map((filename) => (
                                <div key={filename} className="p-3 bg-surface/30 rounded-lg border border-white/5 flex items-center justify-between">
                                    <div className="flex-1 truncate mr-2">
                                        <p className="text-sm text-text-primary truncate">{getCleanModelName(filename)}</p>
                                        <p className="text-xs text-text-secondary">{filename.endsWith('.task') ? 'Task Bundle' : 'LiteRT Model'}</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {llmConfig.liteRTModelPath === filename ? (
                                            <span className="text-xs text-green-400 font-medium px-2 py-1 bg-green-500/10 rounded">Active</span>
                                        ) : (
                                            <button
                                                onClick={() => {
                                                    triggerHaptic();
                                                    onLlmConfigSave({
                                                        ...llmConfig,
                                                        liteRTModelId: 'imported',
                                                        liteRTModelPath: filename
                                                    });
                                                }}
                                                className="px-3 py-1.5 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 text-xs rounded-lg transition-colors border border-blue-500/30"
                                            >
                                                Load
                                            </button>
                                        )}
                                        <button
                                            onClick={() => {
                                                if (externalLiteRTModels.includes(filename)) {
                                                    handleDeleteExternalLiteRTModel(filename);
                                                } else {
                                                    handleDeleteLiteRTModel(filename);
                                                }
                                            }}
                                            className="p-1.5 text-text-secondary hover:text-red-400 transition-colors"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                <button
                    onClick={handleImportLiteRTFile}
                    disabled={isImporting}
                    className="w-full mt-3 py-2 px-4 bg-surface hover:bg-surface/80 border border-white/10 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                >
                    {isImporting ? (
                        <span className="animate-pulse">Importing...</span>
                    ) : (
                        <>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                            </svg>
                            Import LiteRT Model
                        </>
                    )}
                </button>
            </div>
        </div>
    );
};

export default LiteRTSettings;
