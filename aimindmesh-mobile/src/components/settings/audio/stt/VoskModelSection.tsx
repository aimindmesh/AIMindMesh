import React from 'react';
import { SpeechConfig } from '../../../../types';
import { VOSK_MODELS } from '../../../../services/stt/voskModelDownloader';
import { getCleanModelName } from '../../../../utils/stringUtils';


interface VoskModelSectionProps {
    speechConfig: SpeechConfig;
    onSpeechConfigChange: (config: SpeechConfig) => void;
    downloadedModels: string[];
    onDownload: (model: typeof VOSK_MODELS[0]) => void;
    onDelete: (modelId: string) => void;
    onImport: () => void;
    downloadProgress: Record<string, { percentage: number }>;
    isImporting: boolean;
}

export const VoskModelSection: React.FC<VoskModelSectionProps> = ({
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
            <h4 className="text-sm font-semibold text-text-primary mb-2">Vosk Models</h4>
            <div className="grid grid-cols-1 gap-3">
                {VOSK_MODELS.map(model => (
                    <div key={model.id} className="bg-surface/50 p-3 rounded-lg border border-white/5 flex items-center justify-between">
                        <div className="flex-1 min-w-0 mr-3">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="font-medium text-sm text-text-primary truncate">{model.name}</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface border border-white/10 text-text-secondary">
                                    {model.language}
                                </span>
                            </div>
                            <p className="text-xs text-text-secondary truncate">{model.description}</p>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="text-[10px] text-text-tertiary">
                                    {(model.size / (1024 * 1024)).toFixed(0)} MB
                                </span>
                                {downloadProgress[model.id] && (
                                    <div className="flex-1 h-1 bg-surface rounded-full overflow-hidden max-w-[100px]">
                                        <div
                                            className="h-full bg-primary transition-all duration-300"
                                            style={{ width: `${downloadProgress[model.id].percentage}%` }}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex flex-col gap-2 items-end">
                            {downloadedModels.includes(model.id) ? (
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-green-400 font-medium px-2 py-1 bg-green-500/10 rounded">Downloaded</span>
                                    <div className="flex items-center gap-1">
                                        <input
                                            type="radio"
                                            name="voskModelId"
                                            checked={speechConfig.voskModelId === model.id}
                                            onChange={() => onSpeechConfigChange({ ...speechConfig, voskModelId: model.id })}
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

                {/* Custom/Imported Models Section */}
                {downloadedModels.filter(id => !VOSK_MODELS.some(m => m.id === id)).map(modelId => (
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
                            <p className="text-xs text-text-secondary truncate">Imported Model</p>
                        </div>

                        <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1">
                                <input
                                    type="radio"
                                    name="voskModelId"
                                    checked={speechConfig.voskModelId === modelId}
                                    onChange={() => onSpeechConfigChange({ ...speechConfig, voskModelId: modelId })}
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
                            Import Custom Vosk Model
                        </>
                    )}
                </button>
                <p className="text-xs text-text-secondary mt-2 text-center">
                    Import .zip file containing model directory (e.g., vosk-model-small-en-us-0.15)
                </p>
            </div>
        </div>
    );
};
