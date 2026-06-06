import React from 'react';
import { SpeechConfig } from '../../../../types';
import { VAD_MODELS } from '../../../../services/stt/vadModelDownloader';
import { getCleanModelName } from '../../../../utils/stringUtils';

interface VADModelSectionProps {
    speechConfig: SpeechConfig;
    onSpeechConfigChange: (config: SpeechConfig) => void;
    downloadedModels: string[];
    onDownload: (model: typeof VAD_MODELS[0]) => void;
    onDelete: (modelId: string) => void;
    onImport: () => void;
    downloadProgress: Record<string, { percentage: number }>;
    isImporting: boolean;
}

export const VADModelSection: React.FC<VADModelSectionProps> = ({
    speechConfig,
    onSpeechConfigChange,
    downloadedModels,
    onDownload,
    onDelete,
    onImport,
    downloadProgress,
    isImporting
}) => {
    return (
        <div className="space-y-4 bg-surface/30 p-4 rounded-lg border border-white/5">
            <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-text-primary">Voice Activity Detection (VAD)</h4>
                <label className="flex items-center gap-2 cursor-pointer">
                    <span className="text-xs text-text-secondary">Enable</span>
                    <input
                        type="checkbox"
                        checked={speechConfig.enableVAD ?? false}
                        onChange={(e) => onSpeechConfigChange({ ...speechConfig, enableVAD: e.target.checked })}
                        className="w-4 h-4 rounded bg-input border-surface text-primary focus:ring-primary"
                    />
                </label>
            </div>
            <p className="text-xs text-text-secondary mb-3">
                VAD filters out silence and noise, reducing CPU usage and improving speaker embeddings.
            </p>

            {speechConfig.enableVAD && (
                <>
                    {/* VAD Sensitivity Slider */}
                    <div className="mb-4">
                        <label className="text-xs font-medium text-text-primary mb-1 block">
                            Sensitivity: {((speechConfig.vadSensitivity ?? 0.5) * 100).toFixed(0)}%
                        </label>
                        <input
                            type="range"
                            min="30"
                            max="90"
                            value={(speechConfig.vadSensitivity ?? 0.5) * 100}
                            onChange={(e) => onSpeechConfigChange({ ...speechConfig, vadSensitivity: Number(e.target.value) / 100 })}
                            className="w-full h-2 bg-surface rounded-lg appearance-none cursor-pointer"
                        />
                        <div className="flex justify-between text-[10px] text-text-tertiary mt-1">
                            <span>Less Sensitive</span>
                            <span>More Sensitive</span>
                        </div>
                    </div>

                    {/* VAD Models */}
                    <div className="grid grid-cols-1 gap-3">
                        {VAD_MODELS.map(model => (
                            <div key={model.id} className="bg-surface/50 p-3 rounded-lg border border-white/5 flex items-center justify-between">
                                <div className="flex-1 min-w-0 mr-3">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="font-medium text-sm text-text-primary truncate">{model.name}</span>
                                        {model.recommended && (
                                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/30">
                                                Recommended
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-text-secondary truncate">{model.description}</p>
                                    <span className="text-[10px] text-text-tertiary">{model.size}</span>
                                </div>

                                <div className="flex flex-col gap-2 items-end">
                                    {downloadedModels.includes(model.id) ? (
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-green-400 font-medium px-2 py-1 bg-green-500/10 rounded">Downloaded</span>
                                            <div className="flex items-center gap-1">
                                                <input
                                                    type="radio"
                                                    name="vadModelId"
                                                    checked={speechConfig.vadModelId === model.id}
                                                    onChange={() => onSpeechConfigChange({ ...speechConfig, vadModelId: model.id })}
                                                    className="h-4 w-4 text-green-500 bg-input border-surface focus:ring-green-500"
                                                />
                                                <button
                                                    onClick={() => onDelete(model.id)}
                                                    className="p-1.5 text-red-400 hover:bg-red-500/10 rounded-full transition-colors"
                                                    title="Delete Model"
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                    </svg>
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => onDownload(model)}
                                            disabled={!!downloadProgress[model.id]}
                                            className="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 rounded-md text-xs font-medium transition-colors flex items-center gap-1 disabled:opacity-50"
                                        >
                                            {downloadProgress[model.id] ? (
                                                <span>{Math.round(downloadProgress[model.id].percentage)}%</span>
                                            ) : (
                                                <>
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                                    </svg>
                                                    <span>Download</span>
                                                </>
                                            )}
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Custom/Imported VAD Models Section */}
                    <div className="grid grid-cols-1 gap-3 mt-3">
                        {downloadedModels.filter(id => !VAD_MODELS.some(m => m.id === id)).map(modelId => (
                            <div key={modelId} className="bg-surface/50 p-3 rounded-lg border border-purple-500/30 flex items-center justify-between">
                                <div className="flex-1 min-w-0 mr-3">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="font-medium text-sm text-text-primary truncate" title={modelId}>
                                            {getCleanModelName(modelId)}
                                        </span>
                                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                                            Custom
                                        </span>
                                    </div>
                                    <p className="text-xs text-text-secondary truncate">Imported VAD Model</p>
                                </div>

                                <div className="flex items-center gap-2">
                                    <div className="flex items-center gap-1">
                                        <input
                                            type="radio"
                                            name="vadModelId"
                                            checked={speechConfig.vadModelId === modelId}
                                            onChange={() => onSpeechConfigChange({ ...speechConfig, vadModelId: modelId })}
                                            className="h-4 w-4 text-green-500 bg-input border-surface focus:ring-green-500"
                                        />
                                        <button
                                            onClick={() => onDelete(modelId)}
                                            className="p-1.5 text-red-400 hover:bg-red-500/10 rounded-full transition-colors"
                                            title="Delete Model"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="mt-4 pt-4 border-t border-white/5">
                        <button
                            onClick={onImport}
                            disabled={isImporting}
                            className="w-full py-2 px-4 bg-surface hover:bg-surface/80 border border-white/10 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                        >
                            {isImporting ? (
                                <span className="animate-pulse">Importing...</span>
                            ) : (
                                <>
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                    </svg>
                                    Import Custom VAD Model
                                </>
                            )}
                        </button>
                        <p className="text-xs text-text-secondary mt-2 text-center">
                            Import .onnx file (silero-vad.onnx)
                        </p>
                    </div>
                </>
            )}
        </div>
    );
};
