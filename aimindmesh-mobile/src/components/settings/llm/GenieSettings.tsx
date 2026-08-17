import React, { useState, useEffect } from 'react';
import { LLMConfig } from '../../../types';
import { Genie, GenieCapabilities, GenieModelInfo } from 'genie-capacitor';

interface GenieSettingsProps {
    llmConfig: LLMConfig;
    onLlmConfigSave: (config: LLMConfig) => void;
    triggerHaptic: () => void;
    downloadedGenieModels: GenieModelInfo[];
    isImporting: boolean;
    handleImportGenieZipFile: () => Promise<void>;
}

const GenieSettings: React.FC<GenieSettingsProps> = ({
    llmConfig,
    onLlmConfigSave,
    triggerHaptic,
    downloadedGenieModels,
    isImporting,
    handleImportGenieZipFile
}) => {
    const [capabilities, setCapabilities] = useState<GenieCapabilities | null>(null);
    const [loadedStatus, setLoadedStatus] = useState<{ loaded: boolean; modelName?: string; isVision?: boolean }>({ loaded: false });
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        const checkCaps = async () => {
            try {
                const caps = await Genie.getCapabilities();
                setCapabilities(caps);
                const status = await Genie.isLoaded();
                setLoadedStatus(status);
            } catch (e) {
                // Ignore if not supported on platform
            }
        };
        checkCaps();
    }, [llmConfig.nativeModelPath]);

    const handleSelectModel = async (model: GenieModelInfo) => {
        triggerHaptic();
        setIsLoading(true);
        try {
            const res = await Genie.loadModel({
                modelPath: model.path,
                runtime: 'npu'
            });
            if (res.success) {
                onLlmConfigSave({
                    ...llmConfig,
                    provider: 'genie-npu',
                    engine: 'genie',
                    nativeModelPath: model.path,
                    enableVision: model.is_vision || llmConfig.enableVision
                });
                setLoadedStatus({ loaded: true, modelName: res.modelName || model.model_name, isVision: res.isVision });
            } else {
                alert(`Failed to load ${model.model_name}: ${res.error}`);
            }
        } catch (e: any) {
            alert(`Error loading model: ${e.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleUnloadModel = async () => {
        triggerHaptic();
        await Genie.unloadModel();
        setLoadedStatus({ loaded: false });
        onLlmConfigSave({
            ...llmConfig,
            nativeModelPath: undefined
        });
    };

    const formatBytes = (bytes?: number) => {
        if (!bytes) return '';
        const gb = bytes / (1024 * 1024 * 1024);
        if (gb >= 1) return `${gb.toFixed(2)} GB`;
        const mb = bytes / (1024 * 1024);
        return `${mb.toFixed(1)} MB`;
    };

    return (
        <div className="space-y-4 animate-fade-in">
            {/* Qualcomm Hardware Status */}
            <div className="bg-amber-500/10 p-4 rounded-xl border border-amber-500/30">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-lg bg-amber-500/20 text-amber-300">
                            <span className="text-xl">⚡</span>
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-text-primary flex items-center gap-2">
                                Qualcomm Hexagon NPU Engine
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                    {capabilities?.npuArch ? `HTP ${capabilities.npuArch} Active` : 'Snapdragon 8 Elite'}
                                </span>
                            </p>
                            <p className="text-xs text-text-secondary">
                                Native hardware acceleration for Qwen 3.5, Gemma 2, and Llama models
                            </p>
                        </div>
                    </div>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-3 mt-3 border-t border-white/5 text-[11px] text-text-secondary">
                    <div className="bg-surface/40 p-2 rounded-lg">
                        <span className="text-text-tertiary block text-[9px] uppercase">Throughput</span>
                        <span className="text-amber-300 font-semibold">~45–65 tok/s</span>
                    </div>
                    <div className="bg-surface/40 p-2 rounded-lg">
                        <span className="text-text-tertiary block text-[9px] uppercase">Memory</span>
                        <span className="text-amber-300 font-semibold">Zero-Copy ION</span>
                    </div>
                    <div className="bg-surface/40 p-2 rounded-lg">
                        <span className="text-text-tertiary block text-[9px] uppercase">Clocking</span>
                        <span className="text-amber-300 font-semibold">Burst Turbo</span>
                    </div>
                </div>
            </div>

            {/* Loaded Model Card */}
            <div className="border-t border-white/5 pt-2">
                <h5 className="text-sm font-semibold text-text-primary mb-3">Active Qualcomm Model</h5>
                {loadedStatus.loaded || llmConfig.nativeModelPath ? (
                    <div className="p-3.5 bg-surface rounded-xl border border-amber-500/30 flex items-center justify-between">
                        <div className="flex-1 overflow-hidden mr-2">
                            <div className="flex items-center gap-2">
                                <div className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse"></div>
                                <p className="text-sm font-semibold text-text-primary truncate">
                                    {loadedStatus.modelName || llmConfig.nativeModelPath?.split('/').pop()}
                                </p>
                                {loadedStatus.isVision && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                                        📷 Vision
                                    </span>
                                )}
                            </div>
                            <p className="text-xs text-text-secondary mt-0.5 ml-4.5">
                                Ready for NPU Generation & Multi-turn Chat
                            </p>
                        </div>
                        <button
                            onClick={handleUnloadModel}
                            className="text-xs text-red-400 hover:text-red-300 px-3 py-1.5 bg-red-500/10 rounded-lg border border-red-500/20 font-medium"
                        >
                            Unload
                        </button>
                    </div>
                ) : (
                    <p className="text-sm text-text-secondary italic">No Qualcomm model loaded</p>
                )}
            </div>

            {/* Import Qualcomm Model (.zip / folder) */}
            <div className="border-t border-white/5 pt-2">
                <div className="flex items-center justify-between mb-3">
                    <h5 className="text-sm font-semibold text-text-primary">Qualcomm AI Hub Models</h5>
                    <button
                        onClick={handleImportGenieZipFile}
                        disabled={isImporting}
                        className="text-xs bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 px-3 py-1.5 rounded-lg border border-amber-500/30 flex items-center gap-1.5 transition-colors"
                    >
                        {isImporting ? (
                            <>
                                <div className="w-3 h-3 border-2 border-amber-300 border-t-transparent rounded-full animate-spin"></div>
                                <span>Extracting...</span>
                            </>
                        ) : (
                            <>
                                <span>📦</span>
                                <span>Import Model (.zip)</span>
                            </>
                        )}
                    </button>
                </div>

                {/* Models List */}
                {downloadedGenieModels.length > 0 ? (
                    <div className="space-y-2">
                        {downloadedGenieModels.map((model) => {
                            const isCurrent = llmConfig.nativeModelPath === model.path;
                            return (
                                <div
                                    key={model.path}
                                    className={`p-3 rounded-xl border transition-all ${
                                        isCurrent
                                            ? 'bg-amber-500/15 border-amber-500/50'
                                            : 'bg-surface/60 border-white/5 hover:border-white/20'
                                    }`}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex-1 min-w-0 mr-3">
                                            <div className="flex items-center gap-2">
                                                <p className="text-sm font-medium text-text-primary truncate">
                                                    {model.model_name || model.model_id}
                                                </p>
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">
                                                    {model.precision || 'w4a16'}
                                                </span>
                                                {model.is_vision && (
                                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300">
                                                        Vision
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-[11px] text-text-secondary mt-0.5 truncate">
                                                {formatBytes(model.sizeBytes)} • {model.path.split('/').pop()}
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => handleSelectModel(model)}
                                            disabled={isLoading || isCurrent}
                                            className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                                                isCurrent
                                                    ? 'bg-amber-500/30 text-amber-200 cursor-default'
                                                    : 'bg-surface hover:bg-surface/80 text-text-primary border border-white/10'
                                            }`}
                                        >
                                            {isCurrent ? 'Active' : 'Load'}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="p-4 bg-surface/30 rounded-xl border border-white/5 text-center">
                        <p className="text-xs text-text-secondary">
                            No Qualcomm models imported yet.
                        </p>
                        <p className="text-[11px] text-text-tertiary mt-1">
                            Download a pre-compiled model for Snapdragon 8 Elite from Qualcomm AI Hub and tap <strong>Import Model (.zip)</strong>.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default GenieSettings;
