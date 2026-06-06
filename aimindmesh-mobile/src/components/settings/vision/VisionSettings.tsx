import React, { useState, useEffect } from 'react';
import { LLMConfig } from '../../../types';
import { triggerHaptic } from '../../../services/native';
import { RECOMMENDED_PROJECTORS, downloadModel, cancelDownload, ModelDownloadProgress } from '../../../services/model/modelDownloader';
import { logger } from '../../../services/logger';
import { fileImportService } from '../../../services/file/fileImportService';

interface VisionSettingsProps {
    llmConfig: LLMConfig;
    onLlmConfigSave: (newConfig: LLMConfig) => void;
    hfToken: string;
}

const VisionSettings: React.FC<VisionSettingsProps> = ({
    llmConfig,
    onLlmConfigSave,
    hfToken
}) => {
    const [downloadProgress, setDownloadProgress] = useState<Record<string, ModelDownloadProgress>>({});
    const [projectors, setProjectors] = useState<string[]>([]);
    const [isImporting, setIsImporting] = useState(false);

    useEffect(() => {
        // Load local projectors on mount and when changed
        import('../../../services/model/modelDownloader').then(({ getLocalProjectorFiles }) => {
            getLocalProjectorFiles().then(setProjectors);
        });
    }, [isImporting, downloadProgress]);

    const handleDownloadProjector = async (proj: typeof RECOMMENDED_PROJECTORS[0]) => {
        triggerHaptic();
        const filename = proj.id + '.mmproj';

        try {
            setDownloadProgress(prev => ({
                ...prev,
                [proj.id]: {
                    bytesDownloaded: 0,
                    totalBytes: proj.size,
                    percentage: 0,
                    completed: false,
                    failed: false
                }
            }));

            await downloadModel(proj.url, filename, (progress) => {
                setDownloadProgress(prev => ({
                    ...prev,
                    [proj.id]: progress
                }));
            }, hfToken);

            // Trigger refresh
            setIsImporting(prev => !prev);

            setTimeout(() => {
                setDownloadProgress(prev => {
                    const newState = { ...prev };
                    delete newState[proj.id];
                    return newState;
                });
            }, 2000);

        } catch (e) {
            logger.log('error', 'Projector download failed', e);
            alert('Download failed: ' + (e as any).message);
        }
    };

    const handleCancelDownload = async (model: { url: string, id: string }) => {
        triggerHaptic();
        await cancelDownload(model.url);
        setDownloadProgress(prev => {
            const newState = { ...prev };
            delete newState[model.id];
            return newState;
        });
    };

    return (
        <div className="space-y-6 animate-fade-in">
            <h3 className="text-lg font-medium text-text-primary mb-4">Vision Capabilities</h3>

            {/* Main Toggle */}
            <div className="bg-purple-500/5 p-4 rounded-lg border border-purple-500/20 mb-6">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-sm font-medium text-text-primary">Enable Vision Capabilities</p>
                        <p className="text-xs text-text-secondary">Allow the model to "see" images using a multimodal projector</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={llmConfig.enableVision || false}
                            onChange={(e) => {
                                triggerHaptic();
                                // Auto-select a projector if enabled and none selected, but one exists
                                let newProj = llmConfig.multimodalProj;
                                if (e.target.checked && !newProj && projectors.length > 0) {
                                    newProj = projectors[0];
                                }
                                onLlmConfigSave({
                                    ...llmConfig,
                                    enableVision: e.target.checked,
                                    multimodalProj: newProj
                                });
                            }}
                        />
                        <div className="w-11 h-6 bg-surface peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-500"></div>
                    </label>
                </div>
            </div>

            {llmConfig.enableVision && (
                <div className="space-y-6 animate-fade-in">

                    {/* RAM Warning */}
                    <div className="bg-yellow-500/10 p-3 rounded-lg border border-yellow-500/20 flex gap-3">
                        <span className="text-lg">⚠️</span>
                        <div>
                            <p className="text-xs font-semibold text-yellow-200">High RAM Usage Warning</p>
                            <p className="text-[10px] text-yellow-200/80">
                                Enabling vision loads a projector (~300MB-2GB) into RAM.
                                Please ensure you have enough free memory (8GB+ recommended).
                                Disable this when not using image inputs to save battery and resources.
                            </p>
                        </div>
                    </div>

                    <div className="bg-surface/30 rounded-lg p-4 border border-white/5">
                        <div className="flex justify-between items-center mb-4">
                            <label className="text-sm text-text-secondary">Active Multimodal Projector</label>
                            {llmConfig.multimodalProj && (
                                <button
                                    onClick={() => onLlmConfigSave({ ...llmConfig, multimodalProj: undefined })}
                                    className="text-xs text-red-400 hover:text-red-300 bg-red-500/10 px-2 py-1 rounded"
                                >
                                    Clear
                                </button>
                            )}
                        </div>

                        {/* Active Projector Display */}
                        {llmConfig.multimodalProj ? (
                            <div className="flex items-center gap-3 p-3 bg-green-500/10 rounded-lg border border-green-500/20 mb-6">
                                <span className="text-2xl">👁️</span>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-text-primary truncate" title={llmConfig.multimodalProj}>
                                        {decodeURIComponent(llmConfig.multimodalProj.split('/').pop() || '')}
                                    </p>
                                    <p className="text-xs text-green-400 font-medium">Vision Enabled</p>
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center gap-3 p-3 bg-white/5 rounded-lg border border-white/10 mb-6 border-dashed">
                                <span className="text-2xl opacity-50">👁️</span>
                                <div className="flex-1">
                                    <p className="text-sm font-medium text-text-secondary">No Projector Selected</p>
                                    <p className="text-xs text-text-tertiary">Select a projector below to enable image analysis</p>
                                </div>
                            </div>
                        )}

                        {/* Available Projectors List */}
                        <div className="space-y-4">
                            <h4 className="text-sm font-semibold text-text-primary">Local Projectors</h4>

                            {/* Local Files */}
                            <div className="space-y-2">
                                {projectors.length > 0 ? (
                                    <div className="grid grid-cols-1 gap-2">
                                        {projectors.map(proj => (
                                            <div
                                                key={proj}
                                                className={`p-3 rounded-lg border cursor-pointer flex justify-between items-center transition-all
                                            ${llmConfig.multimodalProj === proj
                                                        ? 'bg-green-500/20 border-green-500/40'
                                                        : 'bg-surface/40 border-white/5 hover:bg-surface/60'}`}
                                                onClick={() => {
                                                    if (llmConfig.multimodalProj !== proj) {
                                                        onLlmConfigSave({ ...llmConfig, multimodalProj: proj });
                                                        triggerHaptic();
                                                    }
                                                }}
                                            >
                                                <div className="flex-1 min-w-0">
                                                    <span className="text-sm font-medium truncate block mb-0.5">{decodeURIComponent(proj)}</span>
                                                    {llmConfig.multimodalProj === proj && <span className="text-green-400 text-[10px] font-bold uppercase tracking-wider">Active</span>}
                                                </div>
                                                <button
                                                    onClick={async (e) => {
                                                        e.stopPropagation();
                                                        if (window.confirm(`Delete ${proj}?`)) {
                                                            try {
                                                                const { deleteModel } = await import('../../../services/model/modelDownloader');
                                                                await deleteModel(proj);
                                                                setIsImporting(prev => !prev);
                                                                if (llmConfig.multimodalProj === proj) {
                                                                    onLlmConfigSave({ ...llmConfig, multimodalProj: undefined });
                                                                }
                                                            } catch (e) {
                                                                console.error('Failed to delete', e);
                                                            }
                                                        }
                                                    }}
                                                    className="ml-3 p-2 text-red-400 hover:bg-red-500/10 rounded-full transition-colors"
                                                    title="Delete"
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-xs text-text-tertiary italic">No local projectors found.</p>
                                )}

                                <button
                                    onClick={async () => {
                                        triggerHaptic();
                                        try {
                                            const picked = await fileImportService.pickFile({
                                                types: ['application/octet-stream'],
                                                extensions: ['mmproj'],
                                                destinationDirectory: 'models' // Projectors go to root of Data directory usually
                                            });

                                            if (picked && picked.success) {
                                                setIsImporting(true);
                                                try {
                                                    const { importProjectorFile } = await import('../../../services/model/modelDownloader');
                                                    const path = await importProjectorFile(picked.path, picked.cleanName);
                                                    alert(`Successfully imported: ${picked.cleanName}`);
                                                    // Auto-select after import
                                                    onLlmConfigSave({ ...llmConfig, multimodalProj: path });
                                                } finally {
                                                    setIsImporting(false);
                                                }
                                            }
                                        } catch (e) {
                                            setIsImporting(false);
                                            logger.log('error', 'Failed to import projector', e);
                                            // Don't alert if user just cancelled
                                            if ((e as any).message !== 'canceled' && (e as any).message !== 'No file selected') {
                                                alert('Failed to import: ' + (e as any).message);
                                            }
                                        }
                                    }}
                                    disabled={isImporting}
                                    className="w-full mt-2 py-3 bg-surface/50 hover:bg-surface border border-dashed border-white/20 rounded-lg text-sm text-text-secondary transition-colors flex items-center justify-center gap-2"
                                >
                                    {isImporting ? (
                                        <>
                                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                            <span>Importing...</span>
                                        </>
                                    ) : (
                                        <><span>+</span> Import .mmproj File</>
                                    )}
                                </button>
                            </div>

                            {/* Downloadable Projectors */}
                            <div className="pt-4 border-t border-white/5 mt-4">
                                <h4 className="text-sm font-semibold text-text-primary mb-3">Recommended Projectors</h4>
                                <div className="space-y-3">
                                    {RECOMMENDED_PROJECTORS.map(proj => {
                                        const isDownloading = !!downloadProgress[proj.id];
                                        const progress = downloadProgress[proj.id];
                                        const isDownloaded = projectors.includes(proj.id + '.mmproj');

                                        if (isDownloaded) return null; // Hide if already downloaded

                                        return (
                                            <div key={proj.id} className="p-3 bg-surface/40 rounded-lg border border-white/5 hover:border-white/10 transition-colors">
                                                <div className="flex justify-between items-start mb-2">
                                                    <div>
                                                        <p className="text-sm font-medium text-text-primary">{proj.name}</p>
                                                        <p className="text-xs text-text-tertiary mt-0.5">{proj.description}</p>
                                                        <p className="text-[10px] text-text-tertiary mt-1 opacity-70">Size: ~{Math.round(proj.size / 1024 / 1024)} MB</p>
                                                    </div>
                                                    {!isDownloading ? (
                                                        <button
                                                            onClick={() => handleDownloadProjector(proj)}
                                                            className="text-xs bg-blue-500/20 text-blue-400 px-3 py-1.5 rounded-md border border-blue-500/30 hover:bg-blue-500/30 font-medium transition-colors"
                                                        >
                                                            Download
                                                        </button>
                                                    ) : (
                                                        <button
                                                            onClick={() => handleCancelDownload({ url: proj.url, id: proj.id })}
                                                            className="text-xs text-red-300 hover:text-red-200"
                                                        >
                                                            Cancel
                                                        </button>
                                                    )}
                                                </div>
                                                {isDownloading && (
                                                    <div className="w-full space-y-1">
                                                        <div className="flex justify-between text-[10px] text-text-secondary">
                                                            <span>{(progress?.percentage || 0).toFixed(1)}%</span>
                                                            <span>{progress?.bytesDownloaded ? (progress.bytesDownloaded / 1024 / 1024).toFixed(1) : 0} MB</span>
                                                        </div>
                                                        <div className="w-full bg-surface/50 rounded-full h-1.5 overflow-hidden">
                                                            <div
                                                                className="bg-blue-500 h-full rounded-full transition-all duration-300"
                                                                style={{ width: `${progress?.percentage || 0}%` }}
                                                            ></div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-blue-500/5 p-4 rounded-lg border border-blue-500/20">
                        <div className="flex gap-3">
                            <span className="text-2xl">ℹ️</span>
                            <div>
                                <h4 className="text-sm font-medium text-blue-300">About Vision</h4>
                                <p className="text-xs text-text-secondary mt-1">
                                    Vision capabilities allow local GGUF models to "see" images.
                                    You must use a <strong>multimodal-compatible model</strong> (like Gemma 2, Qwen-VL, LLaVA)
                                    along with a <strong>matching projector file</strong> (.mmproj).
                                </p>
                            </div>
                        </div>

                        {llmConfig.nativeModelPath && llmConfig.multimodalProj && (
                            <div className={`mt-4 p-3 rounded-lg border ${
                                // Heuristic check for compatibility
                                (() => {
                                    const model = llmConfig.nativeModelPath.toLowerCase();
                                    const proj = llmConfig.multimodalProj.toLowerCase();

                                    // Check for obvious mismatches
                                    const mismatch = (
                                        (model.includes('gemma') && !proj.includes('gemma')) ||
                                        (model.includes('llama') && !proj.includes('llama') && !proj.includes('llava')) || // LLaVA often uses Llama
                                        (model.includes('qwen') && !proj.includes('qwen')) ||
                                        (model.includes('phi') && !proj.includes('phi'))
                                    );

                                    return mismatch
                                        ? "bg-red-500/10 border-red-500/30 text-red-300"
                                        : "bg-green-500/10 border-green-500/30 text-green-300 hidden"; // Hidden if looks okay to not clutter
                                })()
                                }`}>
                                {(() => {
                                    const model = llmConfig.nativeModelPath.split('/').pop() || 'Unknown Model';
                                    const proj = llmConfig.multimodalProj.split('/').pop() || 'Unknown Projector';
                                    const modelLower = model.toLowerCase();
                                    const projLower = proj.toLowerCase();

                                    // Explicit warnings
                                    if (modelLower.includes('gemma') && !projLower.includes('gemma')) {
                                        return <p className="text-xs">⚠️ Warning: You selected a <strong>Gemma</strong> model but a non-Gemma projector. This will likely crash.</p>;
                                    }
                                    if (modelLower.includes('qwen') && !projLower.includes('qwen')) {
                                        return <p className="text-xs">⚠️ Warning: You selected a <strong>Qwen</strong> model but a non-Qwen projector. This will likely crash.</p>;
                                    }
                                    if ((modelLower.includes('llama') && !modelLower.includes('llava')) && !projLower.includes('llama')) {
                                        return <p className="text-xs">⚠️ Warning: You selected a <strong>Llama</strong> model. Ensure your projector is explicitly for Llama 3.2 Vision (not LLaVA/Gemma).</p>;
                                    }

                                    return null;
                                })()}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default VisionSettings;
