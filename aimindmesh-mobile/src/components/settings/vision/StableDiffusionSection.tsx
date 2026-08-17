import React, { useState, useEffect } from 'react';
import { LLMConfig } from '../../../types';
import { triggerHaptic } from '../../../services/native';
import { logger } from '../../../services/logger';
import { fileImportService } from '../../../services/file/fileImportService';

interface StableDiffusionSectionProps {
    llmConfig: LLMConfig;
    onLlmConfigSave: (newConfig: LLMConfig) => void;
}

export const StableDiffusionSection: React.FC<StableDiffusionSectionProps> = ({
    llmConfig,
    onLlmConfigSave
}) => {
    const [sdModels, setSdModels] = useState<string[]>([]);
    const [isImportingSD, setIsImportingSD] = useState(false);
    const [sdCapabilities, setSdCapabilities] = useState<{ hasNpu: boolean; npuArch?: string; socModel?: string } | null>(null);

    useEffect(() => {
        // Load local SD models and hardware capabilities
        import('../../../services/image/sdModelDownloader').then(({ listLocalSDModels }) => {
            listLocalSDModels().then(setSdModels);
        });
        import('../../../services/image/imageGenService').then(({ imageGenService }) => {
            imageGenService.getCapabilities().then(setSdCapabilities);
        });
    }, [isImportingSD]);

    const handleImportSDModel = async () => {
        triggerHaptic();
        try {
            const picked = await fileImportService.pickFile({
                extensions: ['zip'],
                destinationDirectory: 'sd-models'
            });

            if (picked && picked.success) {
                setIsImportingSD(true);
                try {
                    const { importSDModel, listLocalSDModels, getSDModelPath } = await import('../../../services/image/sdModelDownloader');
                    const importedPath = await importSDModel(picked.path, picked.cleanName);
                    const models = await listLocalSDModels();
                    setSdModels(models);

                    const modelId = picked.cleanName.replace(/\.zip$/i, '');
                    const modelPath = (await getSDModelPath(modelId)) || importedPath;

                    const { imageGenService } = await import('../../../services/image/imageGenService');
                    const loadOk = await imageGenService.loadModel(modelPath);

                    onLlmConfigSave({
                        ...llmConfig,
                        sdModelId: modelId,
                        sdModelPath: modelPath
                    });

                    if (loadOk) {
                        alert(`Successfully imported and loaded Stable Diffusion model: ${modelId}`);
                    } else {
                        alert(`Imported "${modelId}", but model could not be loaded into NPU memory immediately. Please ensure the bundle contains valid QNN bin files.`);
                    }
                } finally {
                    setIsImportingSD(false);
                }
            }
        } catch (e: any) {
            setIsImportingSD(false);
            logger.log('error', 'Failed to import SD model', e);
            if (e.message !== 'canceled' && e.message !== 'No file selected') {
                alert('Failed to import SD model: ' + e.message);
            }
        }
    };

    const handleDeleteSDModel = async (modelId: string) => {
        triggerHaptic();
        if (window.confirm(`Delete Stable Diffusion model "${modelId}"?`)) {
            try {
                const { deleteSDModel, listLocalSDModels } = await import('../../../services/image/sdModelDownloader');
                await deleteSDModel(modelId);
                const models = await listLocalSDModels();
                setSdModels(models);

                if (llmConfig.sdModelId === modelId) {
                    const { imageGenService } = await import('../../../services/image/imageGenService');
                    await imageGenService.unloadModel();
                    onLlmConfigSave({
                        ...llmConfig,
                        sdModelId: undefined,
                        sdModelPath: undefined
                    });
                }
            } catch (e: any) {
                logger.log('error', 'Failed to delete SD model', e);
                alert('Failed to delete model: ' + e.message);
            }
        }
    };

    const handleSelectSDModel = async (modelId: string) => {
        triggerHaptic();
        try {
            const { getSDModelPath } = await import('../../../services/image/sdModelDownloader');
            const modelPath = await getSDModelPath(modelId);
            if (modelPath) {
                const { imageGenService } = await import('../../../services/image/imageGenService');
                const loadOk = await imageGenService.loadModel(modelPath);
                if (loadOk) {
                    onLlmConfigSave({
                        ...llmConfig,
                        sdModelId: modelId,
                        sdModelPath: modelPath
                    });
                } else {
                    alert(`Failed to load Stable Diffusion model "${modelId}" onto Qualcomm NPU.`);
                }
            }
        } catch (e: any) {
            logger.log('error', 'Failed to select SD model', e);
            alert('Failed to load model: ' + e.message);
        }
    };

    return (
        <div className="bg-amber-500/10 p-4 rounded-xl border border-amber-500/30 space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-lg bg-amber-500/20 text-amber-300">
                        <span className="text-xl">🎨</span>
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-text-primary flex items-center gap-2">
                            Qualcomm NPU Stable Diffusion
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                {sdCapabilities?.hasNpu ? `⚡ HTP ${sdCapabilities.npuArch || 'v79'} Active` : '⚡ Local NPU'}
                            </span>
                        </p>
                        <p className="text-xs text-text-secondary">On-device 512x512 image synthesis in 2–4s (Hexagon CDSP)</p>
                    </div>
                </div>
            </div>

            {/* Local Installed SD Models */}
            <div className="space-y-2 pt-2 border-t border-white/5">
                <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">Installed SD Models</span>
                    {llmConfig.sdModelId && (
                        <span className="text-[11px] text-amber-400 font-mono">Active: {llmConfig.sdModelId}</span>
                    )}
                </div>

                {sdModels.length > 0 ? (
                    <div className="space-y-2">
                        {sdModels.map(modelId => (
                            <div
                                key={modelId}
                                className={`p-3 rounded-lg border flex items-center justify-between transition-all ${
                                    llmConfig.sdModelId === modelId
                                        ? 'bg-amber-500/20 border-amber-500/40'
                                        : 'bg-surface/40 border-white/5 hover:bg-surface/60'
                                }`}
                            >
                                <div
                                    className="flex-1 min-w-0 cursor-pointer mr-3"
                                    onClick={() => handleSelectSDModel(modelId)}
                                >
                                    <div className="flex items-center gap-2 mb-0.5">
                                        <span className="text-sm font-medium text-text-primary truncate block" title={modelId}>
                                            {modelId}
                                        </span>
                                        {llmConfig.sdModelId === modelId && (
                                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/30 text-amber-300 font-bold uppercase tracking-wider">
                                                Active
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-text-secondary truncate">Qualcomm QNN Context Bundle (w8a16)</p>
                                </div>

                                <div className="flex items-center gap-2">
                                    <input
                                        type="radio"
                                        name="activeSDModel"
                                        checked={llmConfig.sdModelId === modelId}
                                        onChange={() => handleSelectSDModel(modelId)}
                                        className="h-4 w-4 text-amber-500 bg-input border-surface focus:ring-amber-500 cursor-pointer"
                                    />
                                    <button
                                        onClick={() => handleDeleteSDModel(modelId)}
                                        className="p-1.5 text-red-400 hover:bg-red-500/10 rounded-full transition-colors"
                                        title="Delete SD Model"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="p-3 bg-white/5 rounded-lg border border-dashed border-white/10 text-center">
                        <p className="text-xs text-text-tertiary">No Stable Diffusion models installed.</p>
                        <p className="text-[11px] text-text-tertiary mt-0.5">Import a Qualcomm AI Hub SD ZIP bundle (containing unet.bin, vae.bin, text_encoder.bin) below.</p>
                    </div>
                )}

                {/* Import SD Model Button */}
                <button
                    onClick={handleImportSDModel}
                    disabled={isImportingSD}
                    className="w-full mt-2 py-2.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 rounded-lg text-xs font-semibold text-amber-300 transition-colors flex items-center justify-center gap-2"
                >
                    {isImportingSD ? (
                        <>
                            <div className="w-3.5 h-3.5 border-2 border-amber-300/30 border-t-amber-300 rounded-full animate-spin"></div>
                            <span>Importing & Unpacking SD Bundle...</span>
                        </>
                    ) : (
                        <>
                            <span>+</span>
                            <span>Import Stable Diffusion Model (.zip)</span>
                        </>
                    )}
                </button>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1 text-[11px] text-text-secondary border-t border-white/5">
                <div className="bg-surface/40 p-2 rounded-lg">
                    <span className="text-text-tertiary block text-[9px] uppercase">Chat Command</span>
                    <code className="text-amber-300 font-mono text-xs">/image &lt;prompt&gt;</code>
                </div>
                <div className="bg-surface/40 p-2 rounded-lg">
                    <span className="text-text-tertiary block text-[9px] uppercase">Edit Command</span>
                    <code className="text-amber-300 font-mono text-xs">/edit &lt;prompt&gt;</code>
                </div>
            </div>
        </div>
    );
};
