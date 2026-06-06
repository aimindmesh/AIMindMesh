import React from 'react';
import { LLMConfig } from '../../../types';
import { RECOMMENDED_MODELS, ModelDownloadProgress } from '../../../services/model/modelDownloader';
import { ModelSlot } from '../../../services/llm/nativeLLM';
import ModelDownloadCard from '../../ui/ModelDownloadCard';
import { getCleanModelName } from '../../../utils/stringUtils';

interface GGUFSettingsProps {
    llmConfig: LLMConfig;
    onLlmConfigSave: (config: LLMConfig) => void;
    hfToken: string;
    onHfTokenChange: (token: string) => void;
    triggerHaptic: () => void;
    downloadProgress: Record<string, ModelDownloadProgress>;
    downloadedModels: string[];
    importedModels: string[];
    externalModels: string[];
    isImporting: boolean;
    isNativeModelLoaded: boolean;
    handleDownloadModel: (model: typeof RECOMMENDED_MODELS[0]) => Promise<void>;
    handleCancelDownload: (model: typeof RECOMMENDED_MODELS[0]) => Promise<void>;
    handleDeleteModel: (modelId: string) => Promise<void>;
    handleDeleteExternalModel: (path: string) => void;
    handleLoadNativeModel: (modelId: string, slot?: ModelSlot) => Promise<void>;
    handleUnloadNativeModel: (slot?: ModelSlot) => Promise<void>;
    handleImportGgufFile: () => Promise<void>;
}

const GGUFSettings: React.FC<GGUFSettingsProps> = ({
    llmConfig,
    onLlmConfigSave,
    hfToken,
    onHfTokenChange,
    triggerHaptic,
    downloadProgress,
    downloadedModels,
    importedModels,
    externalModels,
    isImporting,
    isNativeModelLoaded,
    handleDownloadModel,
    handleCancelDownload,
    handleDeleteModel,
    handleDeleteExternalModel,
    handleLoadNativeModel,
    handleUnloadNativeModel,
    handleImportGgufFile
}) => {
    return (
        <>
            {/* HuggingFace Token */}
            <div className="mb-4">
                <label htmlFor="hfToken" className="block text-sm font-medium text-text-primary mb-2">
                    HuggingFace Access Token (Optional)
                </label>
                <input
                    type="password"
                    name="hfToken"
                    id="hfToken"
                    value={hfToken}
                    onChange={(e) => onHfTokenChange(e.target.value)}
                    placeholder="hf_..."
                    className="block w-full bg-input border-surface rounded-md shadow-sm py-2 px-3 text-text-primary focus:outline-none focus:ring-1 focus:ring-green-500 font-mono text-sm"
                />
                <p className="text-xs text-text-secondary mt-1">
                    Required to download gated models (like Llama 3).
                </p>
            </div>

            <div className="mb-4">
                <label htmlFor="nativeTokenizerPath" className="block text-sm font-medium text-text-primary mb-2">
                    Tokenizer Path (tokenizer.json)
                </label>
                <div className="flex gap-2">
                    <input
                        type="text"
                        name="nativeTokenizerPath"
                        id="nativeTokenizerPath"
                        value={llmConfig.nativeTokenizerPath || ''}
                        onChange={(e) => onLlmConfigSave({ ...llmConfig, nativeTokenizerPath: e.target.value })}
                        placeholder="Auto-detected if empty (.tokenizer.json)"
                        className="block w-full bg-input border-surface rounded-md shadow-sm py-2 px-3 text-text-primary focus:outline-none focus:ring-1 focus:ring-green-500 font-mono text-xs"
                    />
                    <button
                        onClick={async () => {
                            try {
                                const { open } = await import('@tauri-apps/plugin-dialog');
                                const selected = await open({
                                    multiple: false,
                                    filters: [{
                                        name: 'Tokenizer',
                                        extensions: ['json']
                                    }]
                                });
                                if (selected) {
                                    onLlmConfigSave({ ...llmConfig, nativeTokenizerPath: selected as string });
                                }
                            } catch (e) {
                                console.error('Failed to open file dialog', e);
                            }
                        }}
                        className="px-3 py-2 bg-input hover:bg-surface/50 border border-surface/30 rounded-md text-text-secondary hover:text-text-primary transition-colors"
                        title="Browse"
                    >
                        📂
                    </button>
                </div>
                <p className="text-xs text-text-secondary mt-1">
                    Candle requires a <code className="text-green-400">tokenizer.json</code> file.
                </p>
            </div>

            {/* Context Window Config */}
            <div className="mb-4 pt-4 border-t border-white/5">
                <div className="flex justify-between items-center mb-2">
                    <label className="block text-sm font-medium text-text-primary">
                        Context Window Size (nCtx)
                    </label>
                    <span className={`text-xs px-2 py-0.5 rounded border 
                        ${(llmConfig.nCtx || 2048) > 4096 ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30' : 'bg-input text-text-secondary border-surface/30'}`}>
                        {llmConfig.nCtx || 2048} tokens
                    </span>
                </div>
                <input
                    type="range"
                    min="512"
                    max="32768"
                    step="512"
                    value={llmConfig.nCtx || 2048}
                    onChange={(e) => {
                        triggerHaptic();
                        onLlmConfigSave({ ...llmConfig, nCtx: parseInt(e.target.value) });
                    }}
                    className="w-full h-2 bg-surface rounded-lg appearance-none cursor-pointer accent-green-500"
                />
                <div className="flex justify-between text-[10px] text-text-tertiary mt-1 px-1">
                    <span>512</span>
                    <span>2048 (Default)</span>
                    <span>8192</span>
                    <span>32k</span>
                </div>
                <p className="text-xs text-text-secondary mt-2">
                    Higher context allows for longer conversations but requires significantly more RAM.
                    <br />
                    <span className="text-yellow-400/80">⚠ You must reload the model for this to take effect.</span>
                    {llmConfig.useOpenCL && (
                        <>
                            <br />
                            <span className="text-orange-400/80">⚠ OpenCL caps context to max 8192 tokens to prevent allocation crashes.</span>
                        </>
                    )}
                </p>
            </div>

            {/* Memory Mapping */}
            <div className="mb-4 pt-4 border-t border-white/5">
                <label className="flex items-start gap-3 cursor-pointer group">
                    <div className="relative flex items-center">
                        <input
                            type="checkbox"
                            checked={llmConfig.useMmap ?? true}
                            onChange={(e) => {
                                triggerHaptic();
                                onLlmConfigSave({ ...llmConfig, useMmap: e.target.checked });
                            }}
                            className="peer h-5 w-5 rounded border-white/10 bg-surface text-green-500 focus:ring-green-500/20 focus:ring-offset-0"
                        />
                    </div>
                    <div>
                        <span className="block text-sm font-medium text-text-primary group-hover:text-green-400 transition-colors">
                            Use Memory Mapping (mmap)
                        </span>
                        <p className="text-xs text-text-secondary mt-1">
                            Reduces RAM usage by paging model from disk in chunks.
                            <br />
                            <span className="text-green-400/80">Recommended for 1.7B+ models on mobile to prevent crashes.</span>
                        </p>
                    </div>
                </label>
            </div>

            {/* Vulkan GPU Backend */}
            <div className="mb-4 pt-4 border-t border-white/5">
                <label className="flex items-start gap-3 cursor-pointer group">
                    <div className="relative flex items-center">
                        <input
                            type="checkbox"
                            checked={llmConfig.useVulkan ?? false}
                            onChange={(e) => {
                                triggerHaptic();
                                onLlmConfigSave({ ...llmConfig, useVulkan: e.target.checked, useOpenCL: e.target.checked ? false : llmConfig.useOpenCL });
                            }}
                            className="peer h-5 w-5 rounded border-white/10 bg-surface text-green-500 focus:ring-green-500/20 focus:ring-offset-0"
                        />
                    </div>
                    <div>
                        <span className="block text-sm font-medium text-text-primary group-hover:text-green-400 transition-colors">
                            Use GPU Acceleration (Vulkan)
                        </span>
                        <p className="text-xs text-text-secondary mt-1">
                            Offloads computation to the device GPU for faster generation.
                            <br />
                            <span className="text-yellow-400/80">⚠ On Qualcomm Adreno devices, OpenCL below is preferred. Mutually exclusive with OpenCL.</span>
                        </p>
                    </div>
                </label>
            </div>

            {/* OpenCL GPU Backend (Qualcomm Adreno optimized) */}
            <div className="mb-4 pt-4 border-t border-white/5">
                <label className="flex items-start gap-3 cursor-pointer group">
                    <div className="relative flex items-center">
                        <input
                            type="checkbox"
                            checked={llmConfig.useOpenCL ?? false}
                            onChange={(e) => {
                                triggerHaptic();
                                onLlmConfigSave({ ...llmConfig, useOpenCL: e.target.checked, useVulkan: e.target.checked ? false : llmConfig.useVulkan });
                            }}
                            className="peer h-5 w-5 rounded border-white/10 bg-surface text-orange-500 focus:ring-orange-500/20 focus:ring-offset-0"
                        />
                    </div>
                    <div>
                        <span className="block text-sm font-medium text-text-primary group-hover:text-orange-400 transition-colors">
                            Use OpenCL (Qualcomm Adreno GPU — Recommended)
                        </span>
                        <p className="text-xs text-text-secondary mt-1">
                            Uses the Qualcomm-contributed OpenCL backend for llama.cpp. Best performance on Snapdragon Adreno GPUs (Z Fold 5, Z Fold 7).
                            <br />
                            <span className="text-orange-400/80">⚙ Preferred over Vulkan on Adreno. Mutually exclusive with Vulkan.</span>
                        </p>
                    </div>
                </label>
            </div>

            {/* Batch Size */}
            <div className="mb-4 pt-4 border-t border-white/5">
                <div className="flex justify-between items-center mb-2">
                    <label className="block text-sm font-medium text-text-primary">
                        Batch Size (n_batch)
                    </label>
                    <span className="text-xs px-2 py-0.5 rounded border bg-surface text-text-secondary border-white/10">
                        {llmConfig.nBatch || 512}
                    </span>
                </div>
                <input
                    type="range"
                    min="64"
                    max="2048"
                    step="64"
                    value={llmConfig.nBatch || 512}
                    onChange={(e) => {
                        triggerHaptic();
                        onLlmConfigSave({ ...llmConfig, nBatch: parseInt(e.target.value) });
                    }}
                    className="w-full h-2 bg-surface rounded-lg appearance-none cursor-pointer accent-green-500"
                />
                <div className="flex justify-between text-[10px] text-text-tertiary mt-1 px-1">
                    <span>64</span>
                    <span>512 (Default)</span>
                    <span>2048</span>
                </div>
                <p className="text-xs text-text-secondary mt-1">
                    Number of tokens processed in parallel during prompt evaluation. Higher = faster prompt processing, more RAM.
                </p>
            </div>

            {/* Flash Attention */}
            <div className="mb-4 pt-4 border-t border-white/5">
                <label className="flex items-start gap-3 cursor-pointer group">
                    <div className="relative flex items-center">
                        <input
                            type="checkbox"
                            checked={llmConfig.flashAttn ?? false}
                            onChange={(e) => {
                                triggerHaptic();
                                onLlmConfigSave({ ...llmConfig, flashAttn: e.target.checked });
                            }}
                            className="peer h-5 w-5 rounded border-white/10 bg-surface text-green-500 focus:ring-green-500/20 focus:ring-offset-0"
                        />
                    </div>
                    <div>
                        <span className="block text-sm font-medium text-text-primary group-hover:text-green-400 transition-colors">
                            Flash Attention
                        </span>
                        <p className="text-xs text-text-secondary mt-1">
                            Faster attention computation with lower memory usage.
                            <br />
                            <span className="text-yellow-400/80">⚠ May not be supported by all models. Requires model reload.</span>
                        </p>
                    </div>
                </label>
            </div>

            {/* KV Cache Type */}
            <div className="mb-4 pt-4 border-t border-white/5">
                <label className="block text-sm font-medium text-text-primary mb-2">
                    KV Cache Quantization
                </label>
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="text-xs text-text-secondary mb-1 block">Keys</label>
                        <select
                            value={llmConfig.cacheTypeK || 'f16'}
                            onChange={(e) => {
                                triggerHaptic();
                                onLlmConfigSave({ ...llmConfig, cacheTypeK: e.target.value });
                            }}
                            className="w-full bg-input border border-white/10 rounded-md py-1.5 px-2 text-text-primary text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
                        >
                            <option value="f16">f16 (Default)</option>
                            <option value="q8_0">q8_0 (50% less RAM)</option>
                            <option value="q4_0">q4_0 (75% less RAM)</option>
                        </select>
                    </div>
                    <div>
                        <label className="text-xs text-text-secondary mb-1 block">Values</label>
                        <select
                            value={llmConfig.cacheTypeV || 'f16'}
                            onChange={(e) => {
                                triggerHaptic();
                                onLlmConfigSave({ ...llmConfig, cacheTypeV: e.target.value });
                            }}
                            className="w-full bg-input border border-white/10 rounded-md py-1.5 px-2 text-text-primary text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
                        >
                            <option value="f16">f16 (Default)</option>
                            <option value="q8_0">q8_0 (50% less RAM)</option>
                            <option value="q4_0">q4_0 (75% less RAM)</option>
                        </select>
                    </div>
                </div>
                <p className="text-xs text-text-secondary mt-1">
                    Quantize the KV cache to save RAM. Lower precision = less RAM but slightly reduced quality.
                    <br />
                    <span className="text-yellow-400/80">⚠ Requires model reload.</span>
                </p>
            </div>

            {/* GPU Layers */}
            <div className="mb-4 pt-4 border-t border-white/5">
                <div className="flex justify-between items-center mb-2">
                    <label className="block text-sm font-medium text-text-primary">
                        GPU Offload Layers
                    </label>
                    <span className={`text-xs px-2 py-0.5 rounded border ${(llmConfig.nGpuLayers || 0) > 0
                            ? 'bg-green-500/20 text-green-400 border-green-500/30'
                            : 'bg-surface text-text-secondary border-white/10'
                        }`}>
                        {(llmConfig.nGpuLayers || 0) === 0
                            ? 'CPU only'
                            : (llmConfig.nGpuLayers || 0) >= 99
                                ? 'All layers'
                                : `${llmConfig.nGpuLayers} layers`}
                    </span>
                </div>
                <input
                    type="range"
                    min="0"
                    max="99"
                    step="1"
                    value={llmConfig.nGpuLayers || 0}
                    onChange={(e) => {
                        triggerHaptic();
                        onLlmConfigSave({ ...llmConfig, nGpuLayers: parseInt(e.target.value) });
                    }}
                    className="w-full h-2 bg-surface rounded-lg appearance-none cursor-pointer accent-green-500"
                />
                <div className="flex justify-between text-[10px] text-text-tertiary mt-1 px-1">
                    <span>0 (CPU)</span>
                    <span>50</span>
                    <span>99 (All)</span>
                </div>
                <p className="text-xs text-text-secondary mt-1">
                    Number of model layers to offload to GPU. Requires Vulkan or OpenCL enabled above. 99 = offload all layers.
                </p>
            </div>

            {/* Active Model Card */}
            <div className="border-t border-white/5 pt-4">
                <h5 className="text-sm font-semibold text-text-primary mb-3">Loaded Model</h5>
                {llmConfig.nativeModelPath ? (
                    <div className="p-3 bg-surface rounded-lg border border-green-500/30 flex items-center justify-between">
                        <div className="flex-1 overflow-hidden mr-2">
                            <div className="flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full ${isNativeModelLoaded ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`}></div>
                                <p className="text-sm font-medium truncate" title={llmConfig.nativeModelPath}>
                                    {getCleanModelName(llmConfig.nativeModelPath)}
                                </p>
                            </div>
                            <p className="text-xs text-text-secondary mt-0.5 ml-4">
                                {isNativeModelLoaded ? 'Loaded & Ready' : 'Loading...'}
                            </p>
                        </div>
                        <button
                            onClick={() => handleUnloadNativeModel('chat')}
                            className="text-xs text-red-400 hover:text-red-300 px-2 py-1 bg-red-500/10 rounded border border-red-500/20"
                        >
                            Unload
                        </button>
                    </div>
                ) : (
                    <p className="text-sm text-text-secondary italic">No model loaded</p>
                )}
            </div>

            {/* External Models List (Desktop) */}
            {externalModels.length > 0 && (
                <div className="mt-6">
                    <h5 className="text-sm font-semibold text-text-primary mb-3">External Models</h5>
                    <div className="space-y-2">
                        {externalModels.map((path) => {
                            const name = path.split(/[/\\]/).pop() || path;
                            return (
                                <div key={path} className="p-3 bg-blue-500/10 rounded-lg border border-blue-500/20 flex items-center justify-between">
                                    <div className="flex-1 truncate mr-2">
                                        <p className="text-sm text-text-primary truncate" title={path}>{name}</p>
                                        <p className="text-[10px] text-text-secondary truncate">{path}</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {llmConfig.nativeModelPath === path ? (
                                            <span className="text-xs text-green-400 font-medium px-2 py-1 bg-green-500/10 rounded">Active</span>
                                        ) : (
                                            <button
                                                onClick={() => handleLoadNativeModel(path)}
                                                className="px-3 py-1.5 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 text-xs rounded-lg transition-colors border border-blue-500/30"
                                            >
                                                Load
                                            </button>
                                        )}
                                        <button
                                            onClick={() => handleDeleteExternalModel(path)}
                                            className="p-1.5 text-text-secondary hover:text-red-400 transition-colors"
                                            title="Remove from list"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Recommended Models List */}
            <div className="mt-6">
                <h5 className="text-sm font-semibold text-text-primary mb-3">Recommended Models</h5>
                <div className="space-y-3">
                    {RECOMMENDED_MODELS.map((model) => (
                        <ModelDownloadCard
                            key={model.id}
                            model={model}
                            isDownloaded={downloadedModels.includes(model.id)}
                            isDownloading={!!downloadProgress[model.id]}
                            isLoaded={llmConfig.nativeModelPath === model.id + '.gguf'}
                            isLoadedAsTool={llmConfig.toolUseModelPath === model.id + '.gguf'}
                            progress={downloadProgress[model.id]}
                            onDownload={() => handleDownloadModel(model)}
                            onLoad={() => handleLoadNativeModel(model.id)}
                            onDelete={() => handleDeleteModel(model.id)}
                            onCancel={() => handleCancelDownload(model)}
                        />
                    ))}
                </div>
            </div>

            {/* Imported Models List */}
            {importedModels.length > 0 && (
                <div className="mt-6">
                    <h5 className="text-sm font-semibold text-text-primary mb-3">Imported Models</h5>
                    <div className="space-y-2">
                        {importedModels.map((filename) => (
                            <div key={filename} className="p-3 bg-surface/30 rounded-lg border border-white/5 flex items-center justify-between">
                                <div className="flex-1 truncate mr-2">
                                    <p className="text-sm text-text-primary truncate">{getCleanModelName(filename)}</p>
                                    <p className="text-xs text-text-secondary">Custom Import</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    {llmConfig.nativeModelPath === filename ? (
                                        <span className="text-xs text-green-400 font-medium px-2 py-1 bg-green-500/10 rounded">Active</span>
                                    ) : (
                                        <button
                                            onClick={() => handleLoadNativeModel(filename.replace('.gguf', ''))}
                                            className="px-3 py-1.5 bg-green-600/20 text-green-400 hover:bg-green-600/30 text-xs rounded-lg transition-colors border border-green-500/30"
                                        >
                                            Load
                                        </button>
                                    )}
                                    <button
                                        onClick={() => handleDeleteModel(filename.replace('.gguf', ''))}
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
                onClick={handleImportGgufFile}
                disabled={isImporting}
                className="w-full mt-4 py-2 px-4 bg-input hover:bg-surface/50 border border-surface/30 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
                {isImporting ? (
                    <span className="animate-pulse">Importing...</span>
                ) : (
                    <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                        </svg>
                        Import GGUF File
                    </>
                )}
            </button>
        </>
    );
};

export default GGUFSettings;
