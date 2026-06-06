import React from 'react';
import { SpeechConfig } from '../../../../types';
import { triggerHaptic } from '../../../../services/native';

interface VoxtralModelSectionProps {
    speechConfig: SpeechConfig;
    onSpeechConfigChange: (config: SpeechConfig) => void;
    downloadedModels: string[];
    downloadedProjectors: string[];
    onImport: () => void;
    onDelete: (modelId: string) => void;
    isImporting: boolean;
}

export const VoxtralModelSection: React.FC<VoxtralModelSectionProps> = ({
    speechConfig,
    onSpeechConfigChange,
    downloadedModels,
    downloadedProjectors,
    onImport,
    onDelete,
    isImporting
}) => {
    // Auto-select first model if none selected but models exist
    React.useEffect(() => {
        if (!speechConfig.voxtralModel && downloadedModels.length > 0) {
            onSpeechConfigChange({
                ...speechConfig,
                voxtralModel: downloadedModels[0]
            });
        }
    }, [downloadedModels, speechConfig.voxtralModel, onSpeechConfigChange, speechConfig]);

    return (
        <fieldset className="space-y-4">
            <legend className="text-base font-medium textPrimary mb-3">Voxtral Configuration</legend>

            {/* Quality/Latency Presets */}
            <div>
                <label className="text-xs font-medium text-textPrimary mb-2 block">Quality Preset</label>
                <div className="grid grid-cols-2 gap-2">
                    {[
                        { id: 240, label: 'Fast', desc: '240ms latency' },
                        { id: 480, label: 'Balanced', desc: '480ms (recommended)' },
                        { id: 960, label: 'Accurate', desc: '960ms latency' },
                        { id: 2400, label: 'Best', desc: '2.4s latency' }
                    ].map((preset) => (
                        <button
                            key={preset.id}
                            onClick={() => {
                                onSpeechConfigChange({
                                    ...speechConfig,
                                    voxtralLatency: preset.id as 240 | 480 | 960 | 2400
                                });
                                triggerHaptic();
                            }}
                            className={`p-3 rounded-lg border text-left transition-all ${speechConfig.voxtralLatency === preset.id
                                ? 'bg-primary/10 border-primary/40'
                                : 'bg-surface/30 border-white/5 hover:border-primary/20'
                                }`}
                        >
                            <div className="font-medium text-sm textPrimary">{preset.label}</div>
                            <div className="text-xs textSecondary mt-0.5">{preset.desc}</div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Model Selection */}
            <div>
                <label className="text-xs font-medium text-textPrimary mb-2 block">
                    Voxtral Model {downloadedModels.length > 0 && `(${downloadedModels.length} available)`}
                </label>

                {downloadedModels.length === 0 ? (
                    <div className="bg-surface/30 border border-white/5 rounded-lg p-4 text-center">
                        <p className="text-sm textSecondary mb-3">No Voxtral models found</p>
                        <button
                            onClick={() => {
                                onImport();
                                triggerHaptic();
                            }}
                            disabled={isImporting}
                            className="px-4 py-2 rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors disabled:opacity-50"
                        >
                            {isImporting ? 'Importing...' : 'Import .gguf Model'}
                        </button>
                    </div>
                ) : (
                    <>
                        <select
                            name="voxtralModel"
                            value={speechConfig.voxtralModel || ''}
                            onChange={(e) => {
                                onSpeechConfigChange({
                                    ...speechConfig,
                                    voxtralModel: e.target.value
                                });
                                triggerHaptic();
                            }}
                            className="w-full px-3 py-2 rounded-lg bg-input text-textPrimary border border-white/10 focus:border-primary/50 focus:outline-none"
                        >
                            <option value="">Select model...</option>
                            {downloadedModels.map((modelPath) => {
                                const fileName = modelPath.split(/[\\/]/).pop() || modelPath;
                                return (
                                    <option key={modelPath} value={modelPath}>
                                        {fileName}
                                    </option>
                                );
                            })}
                        </select>

                        {/* Projector Status Check */}
                        <div className="mt-2 text-xs">
                            {downloadedProjectors && downloadedProjectors.length > 0 ? (
                                <div className="flex items-center gap-2 text-green-400 bg-green-400/10 p-2 rounded">
                                    <span>✅ Projector found: {downloadedProjectors[0].split('/').pop()}</span>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2 text-yellow-400 bg-yellow-400/10 p-2 rounded">
                                    <span>⚠️ Missing <code>.mmproj</code> file! Voxtral requires a projector file. Use import below.</span>
                                </div>
                            )}
                        </div>

                        <div className="mt-2 flex gap-2">
                            <button
                                onClick={() => {
                                    onImport();
                                    triggerHaptic();
                                }}
                                disabled={isImporting}
                                className="flex-1 px-3 py-2 text-sm rounded-lg bg-surface/30 text-textPrimary border border-white/10 hover:border-primary/30 transition-colors disabled:opacity-50"
                            >
                                {isImporting ? 'Importing...' : 'Import Model / Projector'}
                            </button>

                            {speechConfig.voxtralModel && (
                                <button
                                    onClick={() => {
                                        if (speechConfig.voxtralModel) {
                                            onDelete(speechConfig.voxtralModel);
                                        }
                                    }}
                                    className="px-3 py-2 text-sm rounded-lg bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors"
                                >
                                    Remove
                                </button>
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* Advanced Options */}
            <details className="bg-surface/20 rounded-lg border border-white/5">
                <summary className="px-4 py-3 cursor-pointer text-sm font-medium textPrimary hover:bg-white/5 transition-colors">
                    Advanced Options
                </summary>
                <div className="px-4 pb-4 space-y-3">
                    {/* Threads */}
                    <div>
                        <label className="text-xs font-medium text-textPrimary mb-2 block">
                            CPU Threads: {speechConfig.voxtralThreads || 4}
                        </label>
                        <input
                            type="range"
                            min="1"
                            max="8"
                            value={speechConfig.voxtralThreads || 4}
                            onChange={(e) => {
                                onSpeechConfigChange({
                                    ...speechConfig,
                                    voxtralThreads: parseInt(e.target.value)
                                });
                            }}
                            className="w-full h-2 bg-surface rounded-lg appearance-none cursor-pointer accent-primary"
                        />
                    </div>

                    {/* Context Size */}
                    <div>
                        <label className="text-xs font-medium text-textPrimary mb-2 block">
                            Max Context Length: {(speechConfig.voxtralMaxLen || 45000).toLocaleString()} tokens
                        </label>
                        <input
                            type="range"
                            min="10000"
                            max="131000"
                            step="1000"
                            value={speechConfig.voxtralMaxLen || 45000}
                            onChange={(e) => {
                                onSpeechConfigChange({
                                    ...speechConfig,
                                    voxtralMaxLen: parseInt(e.target.value)
                                });
                            }}
                            className="w-full h-2 bg-surface rounded-lg appearance-none cursor-pointer accent-primary"
                        />
                        <p className="text-xs textSecondary mt-1">
                            {speechConfig.voxtralMaxLen && speechConfig.voxtralMaxLen > 45000
                                ? '⚠️ Higher values require more RAM'
                                : '~1 hour meeting at 45k tokens'}
                        </p>
                    </div>
                </div>
            </details>

            {/* Info Box */}
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                <p className="text-xs text-blue-300 leading-relaxed">
                    <strong>Voxtral Mini 4B Realtime:</strong> High-quality real-time STT optimized for speed. Supports 13 languages in a single model. Requires 2.5-3.2GB RAM (Q4_K_M/Q5_K_M).
                </p>
            </div>
        </fieldset>
    );
};
