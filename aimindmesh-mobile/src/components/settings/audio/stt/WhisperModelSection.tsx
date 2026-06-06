import React from 'react';
import { SpeechConfig, SttMode } from '../../../../types';
import { WHISPER_MODELS } from '../../../../services/stt/whisperModelDownloader';
import { triggerHaptic } from '../../../../services/native';
import { getCleanModelName } from '../../../../utils/stringUtils';

interface WhisperModelSectionProps {
    speechConfig: SpeechConfig;
    onSpeechConfigChange: (config: SpeechConfig) => void;
    downloadedModels: string[];
    onDownload: (model: typeof WHISPER_MODELS[0]) => void;
    onDelete: (modelId: string) => void;
    onImport: () => void;
    downloadProgress: Record<string, { percentage: number }>;
    isImporting: boolean;
}

export const WhisperModelSection: React.FC<WhisperModelSectionProps> = ({
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
                <h4 className="text-sm font-semibold text-text-primary">Whisper Models (Post-Processing)</h4>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                    High Accuracy
                </span>
            </div>
            <p className="text-xs text-text-secondary mb-3">
                Whisper provides higher accuracy transcription for post-processing or background correction.
            </p>

            {/* STT Mode Selection */}
            <div className="mb-4 p-3 bg-surface/50 rounded-lg border border-white/5">
                <label className="text-xs font-medium text-text-primary mb-2 block">STT Processing Mode</label>
                <div className="grid grid-cols-1 gap-2">
                    {[
                        { id: 'off' as SttMode, label: 'Off', desc: 'No post-processing (real-time only)' },
                        { id: 'vosk-only' as SttMode, label: 'Vosk Only', desc: 'Fast, real-time transcription' },
                        { id: 'hybrid' as SttMode, label: 'Hybrid', desc: 'Vosk real-time + Whisper background correction' },
                        { id: 'whisper-post' as SttMode, label: 'Whisper Post-Processing', desc: 'High accuracy after recording' },
                    ].map(mode => (
                        <div
                            key={mode.id}
                            className={`flex items-center p-2 rounded border cursor-pointer transition-all ${speechConfig.sttMode === mode.id
                                ? 'bg-primary/10 border-primary/40'
                                : 'bg-surface/30 border-white/5 hover:border-primary/20'
                                }`}
                            onClick={() => {
                                onSpeechConfigChange({ ...speechConfig, sttMode: mode.id });
                                triggerHaptic();
                            }}
                        >
                            <input
                                type="radio"
                                name="sttMode"
                                value={mode.id}
                                checked={speechConfig.sttMode === mode.id}
                                onChange={() => onSpeechConfigChange({ ...speechConfig, sttMode: mode.id })}
                                className="h-3 w-3 text-primary"
                            />
                            <div className="ml-2">
                                <span className="text-xs font-medium text-text-primary">{mode.label}</span>
                                <p className="text-[10px] text-text-secondary">{mode.desc}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-1 gap-3">
                {WHISPER_MODELS.map(model => (
                    <div key={model.id} className="bg-surface/50 p-3 rounded-lg border border-white/5 flex items-center justify-between">
                        <div className="flex-1 min-w-0 mr-3">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="font-medium text-sm text-text-primary truncate">{model.name}</span>
                                {model.recommended && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/30">
                                        ⭐ Recommended
                                    </span>
                                )}
                            </div>
                            <p className="text-xs text-text-secondary truncate">{model.description}</p>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="text-[10px] text-text-tertiary">{model.size}</span>
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
                                            name="whisperModelId"
                                            checked={speechConfig.whisperModelId === model.id}
                                            onChange={() => onSpeechConfigChange({ ...speechConfig, whisperModelId: model.id })}
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

                {/* Custom/Imported Whisper Models Section */}
                {downloadedModels.filter(id => !WHISPER_MODELS.some(m => m.id === id)).map(modelId => (
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
                            <p className="text-xs text-text-secondary truncate">Imported Whisper Model</p>
                        </div>

                        <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1">
                                <input
                                    type="radio"
                                    name="whisperModelId"
                                    checked={speechConfig.whisperModelId === modelId}
                                    onChange={() => onSpeechConfigChange({ ...speechConfig, whisperModelId: modelId })}
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

            <div className="mt-4 pt-4 border-t border-white/5 space-y-4">
                <h5 className="text-xs font-semibold text-text-primary mb-3">Performance Settings</h5>

                {/* Threads */}
                <div>
                    <div className="flex justify-between text-xs mb-1">
                        <span className="text-text-secondary">CPU Threads</span>
                        <span className="text-primary font-mono">{speechConfig.whisperThreads || 4}</span>
                    </div>
                    <input
                        type="range"
                        min="1"
                        max="8"
                        step="1"
                        value={speechConfig.whisperThreads || 4}
                        onChange={(e) => {
                            onSpeechConfigChange({ ...speechConfig, whisperThreads: parseInt(e.target.value) });
                            triggerHaptic();
                        }}
                        className="w-full h-1 bg-surface rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                    <p className="text-[10px] text-text-tertiary mt-1">More threads = faster specific segments, but higher CPU usage.</p>
                </div>

                {/* Beam Size */}
                <div>
                    <div className="flex justify-between text-xs mb-1">
                        <span className="text-text-secondary">Beam Size</span>
                        <span className="text-primary font-mono">{speechConfig.whisperBeamSize || 5}</span>
                    </div>
                    <input
                        type="range"
                        min="1"
                        max="10"
                        step="1"
                        value={speechConfig.whisperBeamSize || 5}
                        onChange={(e) => {
                            onSpeechConfigChange({ ...speechConfig, whisperBeamSize: parseInt(e.target.value) });
                            triggerHaptic();
                        }}
                        className="w-full h-1 bg-surface rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                    <p className="text-[10px] text-text-tertiary mt-1">Higher = more accurate but slower. Default: 5 (Accurate), 1 (Fast).</p>
                </div>

                {/* Best Of */}
                <div>
                    <div className="flex justify-between text-xs mb-1">
                        <span className="text-text-secondary">Best Of Candidates</span>
                        <span className="text-primary font-mono">{speechConfig.whisperBestOf || 1}</span>
                    </div>
                    <input
                        type="range"
                        min="1"
                        max="10"
                        step="1"
                        value={speechConfig.whisperBestOf || 1}
                        onChange={(e) => {
                            onSpeechConfigChange({ ...speechConfig, whisperBestOf: parseInt(e.target.value) });
                            triggerHaptic();
                        }}
                        className="w-full h-1 bg-surface rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                </div>

                {/* Temperature */}
                <div>
                    <div className="flex justify-between text-xs mb-1">
                        <span className="text-text-secondary">Temperature</span>
                        <span className="text-primary font-mono">{(speechConfig.whisperTemperature || 0.0).toFixed(1)}</span>
                    </div>
                    <input
                        type="range"
                        min="0.0"
                        max="1.0"
                        step="0.1"
                        value={speechConfig.whisperTemperature || 0.0}
                        onChange={(e) => {
                            onSpeechConfigChange({ ...speechConfig, whisperTemperature: parseFloat(e.target.value) });
                            triggerHaptic();
                        }}
                        className="w-full h-1 bg-surface rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                    <p className="text-[10px] text-text-tertiary mt-1">Lower (0.0) = deterministic/accurate. Higher = more creative.</p>
                </div>

                {/* Chunk Size */}
                <div>
                    <div className="flex justify-between text-xs mb-1">
                        <span className="text-text-secondary">Streaming Chunk Size</span>
                        <span className="text-primary font-mono">{speechConfig.whisperChunkSize || 20}s</span>
                    </div>
                    <input
                        type="range"
                        min="5"
                        max="60"
                        step="5"
                        value={speechConfig.whisperChunkSize || 20}
                        onChange={(e) => {
                            onSpeechConfigChange({ ...speechConfig, whisperChunkSize: parseInt(e.target.value) });
                            triggerHaptic();
                        }}
                        className="w-full h-1 bg-surface rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                    <p className="text-[10px] text-text-tertiary mt-1">Size of audio chunks for real-time transcription (default: 20s).</p>
                </div>

                {/* Diarization Toggle */}
                <div className="flex items-center justify-between pt-2">
                    <div>
                        <div className="flex text-xs font-medium text-text-primary">Run Diarization after Whisper</div>
                        <p className="text-[10px] text-text-secondary">Identify speakers after transcription (slower)</p>
                    </div>
                    <div
                        className={`w-9 h-5 rounded-full p-0.5 cursor-pointer transition-colors ${speechConfig.enableWhisperDiarization ? 'bg-primary' : 'bg-surface border border-white/10'}`}
                        onClick={() => {
                            onSpeechConfigChange({ ...speechConfig, enableWhisperDiarization: !speechConfig.enableWhisperDiarization });
                            triggerHaptic();
                        }}
                    >
                        <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${speechConfig.enableWhisperDiarization ? 'translate-x-4' : 'translate-x-0'}`} />
                    </div>
                </div>
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
                            Import Custom Whisper Model
                        </>
                    )}
                </button>
                <p className="text-xs text-text-secondary mt-2 text-center">
                    Import .bin file (ggml-*.bin)
                </p>
            </div>
        </div>
    );
};
