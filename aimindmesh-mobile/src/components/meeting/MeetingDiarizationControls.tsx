import React, { useState } from 'react';
import { ClusteringAlgorithm } from '../../types';
import { RecognitionMode } from '../../types/meeting';

interface MeetingDiarizationControlsProps {
    recognitionMode: RecognitionMode;
    diarizationSensitivity: number;
    setDiarizationSensitivity: (value: number) => void;
    temporalSmoothing: number;
    setTemporalSmoothing: (value: number) => void;
    embeddingDuration: number;
    setEmbeddingDuration: (value: number) => void;
    targetSpeakerCount: number | undefined;
    setTargetSpeakerCount: (value: number | undefined) => void;
    clusteringAlgorithm: ClusteringAlgorithm;
    setClusteringAlgorithm: (value: ClusteringAlgorithm) => void;

    // Advanced Diarization
    embeddingThreshold: number;
    setEmbeddingThreshold: (value: number) => void;
    embeddingRejectionThreshold: number;
    setEmbeddingRejectionThreshold: (value: number) => void;
    embeddingAdaptationRate: number;
    setEmbeddingAdaptationRate: (value: number) => void;
    minEmbeddingMagnitude: number;
    setMinEmbeddingMagnitude: (value: number) => void;
}

export const MeetingDiarizationControls: React.FC<MeetingDiarizationControlsProps> = ({
    recognitionMode,
    diarizationSensitivity,
    setDiarizationSensitivity,
    temporalSmoothing,
    setTemporalSmoothing,
    embeddingDuration,
    setEmbeddingDuration,
    targetSpeakerCount,
    setTargetSpeakerCount,
    embeddingThreshold,
    setEmbeddingThreshold,
    embeddingRejectionThreshold,
    setEmbeddingRejectionThreshold,
    embeddingAdaptationRate,
    setEmbeddingAdaptationRate,
    minEmbeddingMagnitude,
    setMinEmbeddingMagnitude,
}) => {
    const [showAdvancedDiarization, setShowAdvancedDiarization] = useState(false);

    if (recognitionMode === 'off') {
        return null;
    }

    return (
        <>
            {/* Sliders group - Dedicated row */}
            <div className="flex flex-wrap items-center justify-between sm:justify-start gap-4 p-2 bg-surface/20 rounded-lg border border-white/5">
                {/* Diarization Sensitivity */}
                <div className="flex items-center gap-2 flex-grow sm:flex-grow-0">
                    <span className="text-xs text-text-secondary whitespace-nowrap">Sensitivity:</span>
                    <input
                        type="range"
                        min="0.3"
                        max="0.8"
                        step="0.05"
                        value={diarizationSensitivity}
                        onChange={(e) => setDiarizationSensitivity(parseFloat(e.target.value))}
                        className="w-full sm:w-24 h-1.5 bg-surface-hover rounded-lg appearance-none cursor-pointer accent-primary"
                        title={`Speaker detection sensitivity: ${diarizationSensitivity.toFixed(2)}`}
                    />
                    <span className="text-xs text-text-secondary w-8 font-mono text-right">{diarizationSensitivity.toFixed(2)}</span>
                </div>

                <div className="h-4 w-px bg-white/10 hidden sm:block"></div>

                {/* Temporal Smoothing */}
                <div className="flex items-center gap-2 flex-grow sm:flex-grow-0">
                    <span className="text-xs text-text-secondary whitespace-nowrap">Min Pause:</span>
                    <input
                        type="range"
                        min="0"
                        max="10000"
                        step="500"
                        value={temporalSmoothing}
                        onChange={(e) => setTemporalSmoothing(parseInt(e.target.value))}
                        className="w-full sm:w-20 h-1.5 bg-surface-hover rounded-lg appearance-none cursor-pointer accent-primary"
                        title={`Minimum time between speaker switches: ${temporalSmoothing / 1000} s`}
                    />
                    <span className="text-xs text-text-secondary w-8 font-mono text-right">{(temporalSmoothing / 1000).toFixed(1)}s</span>
                </div>

                <div className="h-4 w-px bg-white/10 hidden sm:block"></div>

                {/* Embedding Duration (only for ONNX mode) */}
                {recognitionMode === 'precise' && (
                    <div className="flex items-center gap-2 flex-grow sm:flex-grow-0">
                        <span className="text-xs text-text-secondary whitespace-nowrap">Audio:</span>
                        <input
                            type="range"
                            min="2"
                            max="6"
                            step="0.5"
                            value={embeddingDuration}
                            onChange={(e) => setEmbeddingDuration(parseFloat(e.target.value))}
                            className="w-full sm:w-16 h-1.5 bg-surface-hover rounded-lg appearance-none cursor-pointer accent-primary"
                            title={`Audio duration for voice embedding: ${embeddingDuration} s (longer = more precise)`}
                        />
                        <span className="text-xs text-text-secondary w-6 font-mono text-right">{embeddingDuration}s</span>
                    </div>
                )}

                <div className="h-4 w-px bg-white/10 hidden sm:block"></div>

                {/* Target Speaker Count */}
                <div className="flex items-center gap-2">
                    <span className="text-xs text-text-secondary whitespace-nowrap">Speakers:</span>
                    <select
                        value={targetSpeakerCount !== undefined ? targetSpeakerCount.toString() : 'auto'}
                        onChange={(e) => setTargetSpeakerCount(e.target.value === 'auto' ? undefined : parseInt(e.target.value))}
                        className="bg-surface text-text-primary text-xs rounded px-2 py-1 border border-white/10"
                        title={'Number of speakers (auto = automatic detection)'}
                    >
                        <option value="auto">Auto</option>
                        <option value="2">2</option>
                        <option value="3">3</option>
                        <option value="4">4</option>
                        <option value="5">5+</option>
                    </select>
                </div>

            </div>

            {/* Advanced Diarization Settings (Collapsible) */}
            <div className="bg-surface/20 rounded-lg border border-white/5 p-2 mt-4">
                <button
                    onClick={() => setShowAdvancedDiarization(!showAdvancedDiarization)}
                    className="flex items-center gap-2 text-xs font-medium text-text-secondary hover:text-white transition-colors w-full"
                >
                    <span className="text-[10px]">{showAdvancedDiarization ? '▼' : '▶'}</span> Advanced Diarization
                </button>

                {showAdvancedDiarization && (
                    <div className="mt-3 space-y-3 animate-fade-in pl-2 border-l border-white/10 ml-1">
                        {/* Match Threshold */}
                        <div>
                            <div className="flex justify-between mb-1">
                                <label className="text-xs text-text-secondary">Match Threshold</label>
                                <span className="text-xs font-mono text-primary">{embeddingThreshold?.toFixed(2) || '0.60'}</span>
                            </div>
                            <input
                                type="range"
                                min="0.50"
                                max="0.95"
                                step="0.01"
                                value={embeddingThreshold || 0.60}
                                onChange={(e) => setEmbeddingThreshold(parseFloat(e.target.value))}
                                className="w-full h-1.5 bg-surface-hover rounded-lg appearance-none cursor-pointer accent-primary"
                            />
                        </div>

                        {/* Rejection Threshold */}
                        <div>
                            <div className="flex justify-between mb-1">
                                <label className="text-xs text-text-secondary">Rejection Threshold</label>
                                <span className="text-xs font-mono text-primary">{embeddingRejectionThreshold?.toFixed(2) || '0.35'}</span>
                            </div>
                            <input
                                type="range"
                                min="0.30"
                                max="0.90"
                                step="0.01"
                                value={embeddingRejectionThreshold || 0.35}
                                onChange={(e) => setEmbeddingRejectionThreshold(parseFloat(e.target.value))}
                                className="w-full h-1.5 bg-surface-hover rounded-lg appearance-none cursor-pointer accent-primary"
                            />
                        </div>

                        <div className="flex gap-4">
                            {/* Adaptation Rate */}
                            <div className="flex-1">
                                <div className="flex justify-between mb-1">
                                    <label className="text-xs text-text-secondary">Adaptation</label>
                                    <span className="text-xs font-mono text-primary">{embeddingAdaptationRate?.toFixed(2) || '0.03'}</span>
                                </div>
                                <input
                                    type="range"
                                    min="0.0"
                                    max="0.20"
                                    step="0.01"
                                    value={embeddingAdaptationRate || 0.03}
                                    onChange={(e) => setEmbeddingAdaptationRate(parseFloat(e.target.value))}
                                    className="w-full h-1.5 bg-surface-hover rounded-lg appearance-none cursor-pointer accent-primary"
                                />
                            </div>

                            {/* Min Magnitude */}
                            <div className="flex-1">
                                <div className="flex justify-between mb-1">
                                    <label className="text-xs text-text-secondary">Min Mag</label>
                                    <span className="text-xs font-mono text-primary">{minEmbeddingMagnitude?.toFixed(2) || '0.50'}</span>
                                </div>
                                <input
                                    type="range"
                                    min="0.0"
                                    max="1.5"
                                    step="0.05"
                                    value={minEmbeddingMagnitude || 0.50}
                                    onChange={(e) => setMinEmbeddingMagnitude(parseFloat(e.target.value))}
                                    className="w-full h-1.5 bg-surface-hover rounded-lg appearance-none cursor-pointer accent-primary"
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
};
