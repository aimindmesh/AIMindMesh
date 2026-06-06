import React from 'react';
import { MicrophoneIcon } from '../../constants';
import { ClusteringAlgorithm, SpeechConfig, WhisperLanguage } from '../../types';
import { RecognitionMode, TranscriptionMode } from '../../types/meeting';

interface MeetingHeaderProps {
    onClose: () => void;
    onOpenHistory: () => void;
    // Recognition settings
    recognitionMode: RecognitionMode;
    setRecognitionMode: (mode: RecognitionMode) => void;
    speechConfig?: SpeechConfig;
    // Diarization settings
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
    // Language settings
    transcriptionLanguage: WhisperLanguage;
    setTranscriptionLanguage: (value: WhisperLanguage) => void;
    // New Settings
    transcriptionMode: TranscriptionMode;
    setTranscriptionMode: (mode: TranscriptionMode) => void;
    whisperChunkSize: number;
    setWhisperChunkSize: (value: number) => void;

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

const MeetingHeader: React.FC<MeetingHeaderProps> = ({
    onClose,
    onOpenHistory,
    recognitionMode,
    setRecognitionMode,
    speechConfig,
    diarizationSensitivity,
    setDiarizationSensitivity,
    temporalSmoothing,
    setTemporalSmoothing,
    embeddingDuration,
    setEmbeddingDuration,
    targetSpeakerCount,
    setTargetSpeakerCount,
    clusteringAlgorithm,
    setClusteringAlgorithm,
    transcriptionLanguage,
    setTranscriptionLanguage,
    transcriptionMode,
    setTranscriptionMode,
    whisperChunkSize,
    setWhisperChunkSize,

    embeddingThreshold,
    setEmbeddingThreshold,
    embeddingRejectionThreshold,
    setEmbeddingRejectionThreshold,
    embeddingAdaptationRate,
    setEmbeddingAdaptationRate,
    minEmbeddingMagnitude,
    setMinEmbeddingMagnitude
}) => {
    const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
    const [showAdvancedDiarization, setShowAdvancedDiarization] = React.useState(false);

    return (
        <header className="flex flex-col border-b border-surface bg-background/95 backdrop-blur-md sticky top-0 z-10 transition-shadow shadow-sm">
            {/* Top Row: Navigation & Title */}
            <div className="flex justify-between items-center p-4">
                <div className="flex items-center gap-3">
                    <button
                        onClick={onClose}
                        className="p-2 -ml-2 hover:bg-surface rounded-full text-text-secondary hover:text-primary transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50"
                        title="Go Back"
                        aria-label="Go Back"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                        </svg>
                    </button>
                    <div className="flex flex-col">
                        <h2 className="text-xl font-bold text-primary flex items-center gap-2">
                            <MicrophoneIcon className="w-6 h-6" />
                            Meeting Assistant
                        </h2>
                        {/* Compact Status Indicator (Visible when collapsed) */}
                        {!isSettingsOpen && (
                            <div className="flex items-center gap-2 text-[10px] text-text-secondary mt-0.5 animate-fade-in">
                                {/* Recording Status */}
                                <span className={`w-1.5 h-1.5 rounded-full ${transcriptionMode === 'off' ? 'bg-gray-500' : 'bg-red-500 animate-pulse'}`}></span>

                                {/* Transcription Mode Info */}
                                <span className={transcriptionMode === 'whisper' ? 'text-purple-300' : transcriptionMode === 'voxtral' ? 'text-fuchsia-300' : transcriptionMode === 'vosk' ? 'text-blue-300' : 'text-gray-400'}>
                                    {transcriptionMode === 'off' ? 'Audio Rec' : transcriptionMode === 'whisper' ? 'Whisper Live' : transcriptionMode === 'voxtral' ? 'Voxtral Live' : 'Vosk Live'}
                                </span>

                                <span className="text-white/20">•</span>

                                {/* Speaker Mode Info */}
                                <span className={recognitionMode === 'precise' ? 'text-purple-300' : recognitionMode === 'fast' ? 'text-blue-300' : 'text-gray-400'}>
                                    {recognitionMode === 'off' ? 'No Diarization' : recognitionMode === 'precise' ? 'Precise Spk' : 'Std Spk'}
                                </span>
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                        className={`text-text-secondary hover:text-white flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors text-sm font-medium border ${isSettingsOpen ? 'bg-surface border-white/10' : 'border-transparent hover:bg-surface hover:border-white/5'}`}
                        title={isSettingsOpen ? "Hide Settings" : "Show Settings"}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                        </svg>
                        <span className="hidden sm:inline">Settings</span>
                    </button>

                    <button
                        onClick={onOpenHistory}
                        className="text-text-secondary hover:text-white flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-surface transition-colors text-sm font-medium border border-transparent hover:border-white/5"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 opacity-70" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                        </svg>
                        <span className="hidden sm:inline">History</span>
                    </button>
                </div>
            </div>

            {/* Collapsible Settings Panel */}
            {isSettingsOpen && (
                <div className="px-4 pb-4 space-y-4 animate-fade-in-down border-t border-white/5 pt-4 bg-surface/10">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-semibold text-text-primary">Transcription Settings</h3>
                    </div>

                    {/* Transcription Mode Selector */}
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">
                            Real-time Transcription
                        </span>
                        <div className="flex bg-surface rounded-lg p-1 border border-white/5">
                            <button
                                onClick={() => setTranscriptionMode('off')}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-2 ${transcriptionMode === 'off'
                                    ? 'bg-gray-600/80 text-white shadow-sm ring-1 ring-white/10'
                                    : 'text-text-secondary hover:text-white'
                                    }`}
                                title="No real-time transcription"
                            >
                                <div className={`w-1.5 h-1.5 rounded-full ${transcriptionMode === 'off' ? 'bg-white' : 'bg-gray-500'}`} />
                                Off
                            </button>
                            <button
                                onClick={() => setTranscriptionMode('vosk')}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-2 ${transcriptionMode === 'vosk'
                                    ? 'bg-blue-600/80 text-white shadow-sm ring-1 ring-white/10'
                                    : 'text-text-secondary hover:text-white'
                                    }`}
                                title="Vosk (Standard) - Fast, on-device, continuous"
                            >
                                <div className={`w-1.5 h-1.5 rounded-full ${transcriptionMode === 'vosk' ? 'bg-white' : 'bg-blue-500'}`} />
                                Vosk
                            </button>
                            <button
                                onClick={() => setTranscriptionMode('voxtral')}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-2 ${transcriptionMode === 'voxtral'
                                    ? 'bg-fuchsia-600/80 text-white shadow-sm ring-1 ring-white/10'
                                    : 'text-text-secondary hover:text-white'
                                    }`}
                                title="Voxtral (Premium) - High-quality real-time, 13 languages"
                            >
                                <div className={`w-1.5 h-1.5 rounded-full ${transcriptionMode === 'voxtral' ? 'bg-white' : 'bg-fuchsia-500'}`} />
                                Voxtral
                            </button>
                            <button
                                onClick={() => setTranscriptionMode('whisper')}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-2 ${transcriptionMode === 'whisper'
                                    ? 'bg-purple-600/80 text-white shadow-sm ring-1 ring-white/10'
                                    : 'text-text-secondary hover:text-white'
                                    }`}
                                title="Whisper (High Quality) - Slower, chunk-based"
                            >
                                <div className={`w-1.5 h-1.5 rounded-full ${transcriptionMode === 'whisper' ? 'bg-white' : 'bg-purple-500'}`} />
                                Whisper
                            </button>
                        </div>
                    </div>

                    {/* Whisper Chunk Size Slider (Only visible if Whisper is selected) */}
                    {transcriptionMode === 'whisper' && (
                        <div className="flex items-center gap-3 p-2 bg-purple-500/10 rounded-lg border border-purple-500/20 animate-fade-in">
                            <span className="text-xs text-purple-200 whitespace-nowrap w-24">Chunk Size:</span>
                            <input
                                type="range"
                                min="2"
                                max="10"
                                step="5"
                                value={whisperChunkSize}
                                onChange={(e) => setWhisperChunkSize(parseInt(e.target.value))}
                                className="w-full h-1.5 bg-surface-hover rounded-lg appearance-none cursor-pointer accent-purple-500"
                                title={`Transcribe every ${whisperChunkSize} seconds`}
                            />
                            <span className="text-xs text-purple-200 font-mono w-8 text-right">{whisperChunkSize}s</span>
                        </div>
                    )}

                    {/* Speaker ID Mode Selector */}
                    <div className={`flex items-center justify-between ${transcriptionMode === 'off' ? 'opacity-50' : ''}`}>
                        <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">
                            Speaker Recognition
                        </span>
                        <div className="flex bg-surface rounded-lg p-1 border border-white/5">
                            <button
                                onClick={() => setRecognitionMode('off')}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-2 ${recognitionMode === 'off'
                                    ? 'bg-gray-600 text-white shadow-sm'
                                    : 'text-text-secondary hover:text-white'
                                    }`}
                                title="No speaker recognition - Audio recording only"
                            >
                                <div className="w-2 h-2 rounded-full bg-gray-400" />
                                Audio Only
                            </button>
                            <button
                                onClick={() => transcriptionMode !== 'off' && setRecognitionMode('fast')}
                                disabled={transcriptionMode === 'off'}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-2 ${recognitionMode === 'fast'
                                    ? 'bg-primary text-white shadow-sm'
                                    : 'text-text-secondary hover:text-white'
                                    } ${transcriptionMode === 'off' ? 'cursor-not-allowed' : ''}`}
                                title={transcriptionMode === 'off' ? "Available only with transcription" : "Vosk Embeddings - Fast speaker recognition, less precise"}
                            >
                                <div className="w-2 h-2 rounded-full bg-blue-400" />
                                Standard
                            </button>
                            <button
                                onClick={() => transcriptionMode !== 'off' && setRecognitionMode('precise')}
                                disabled={transcriptionMode === 'off'}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-2 ${recognitionMode === 'precise'
                                    ? 'bg-purple-500 text-white shadow-sm'
                                    : 'text-text-secondary hover:text-white'
                                    } ${transcriptionMode === 'off' ? 'cursor-not-allowed' : ''}`}
                                title={transcriptionMode === 'off' ? "Available only with transcription" : "ONNX ECAPA Embeddings - Precise speaker recognition, requires ONNX model"}
                            >
                                <div className="w-2 h-2 rounded-full bg-purple-300" />
                                Precise
                            </button>
                        </div>
                    </div>

                    {/* Language Selector (relevant for Whisper modes) */}
                    {(transcriptionMode === 'whisper' || speechConfig?.sttMode === 'whisper-post' || speechConfig?.sttMode === 'hybrid') && (
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">
                                Language
                            </span>
                            <div className="flex items-center gap-2">
                                <select
                                    value={transcriptionLanguage}
                                    onChange={(e) => setTranscriptionLanguage(e.target.value as WhisperLanguage)}
                                    className="bg-surface text-text-primary text-xs rounded-lg px-3 py-1.5 border border-white/10 focus:ring-1 focus:ring-primary focus:outline-none"
                                    title="Transcription language"
                                >
                                    <option value="auto">Auto Detect</option>
                                    <option value="en">English</option>
                                    <option value="it">Italiano</option>
                                </select>
                            </div>
                        </div>
                    )}

                    {/* Sliders group - Dedicated row (hidden in 'off' mode) */}
                    {recognitionMode !== 'off' && (
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
                                    title={`Minimum time between speaker switches: ${temporalSmoothing / 1000}s`}
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
                                        title={`Audio duration for embedding: ${embeddingDuration}s (longer = more precise)`}
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
                                    title="Number of speakers (auto = automatic detection)"
                                >
                                    <option value="auto">Auto</option>
                                    <option value="2">2</option>
                                    <option value="3">3</option>
                                    <option value="4">4</option>
                                    <option value="5">5+</option>
                                </select>
                            </div>

                            <div className="h-4 w-px bg-white/10 hidden sm:block"></div>

                            {/* Clustering Algorithm */}
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-text-secondary whitespace-nowrap">Algorithm:</span>
                                <select
                                    value={clusteringAlgorithm}
                                    onChange={(e) => setClusteringAlgorithm(e.target.value as ClusteringAlgorithm)}
                                    className="bg-surface text-text-primary text-xs rounded px-2 py-1 border border-white/10"
                                    title="Clustering algorithm for post-processing"
                                >
                                    <option value="ahc">AHC (Standard)</option>
                                    <option value="spectral">Spectral (Precise)</option>
                                    <option value="incremental">Incremental (Fast)</option>
                                </select>
                            </div>
                        </div>
                    )}

                    {/* Advanced Diarization Settings (Collapsible) */}
                    {recognitionMode !== 'off' && (
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
                                            <span className="text-xs font-mono text-primary">{embeddingThreshold?.toFixed(2) || '0.80'}</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="0.50"
                                            max="0.95"
                                            step="0.01"
                                            value={embeddingThreshold || 0.80}
                                            onChange={(e) => setEmbeddingThreshold(parseFloat(e.target.value))}
                                            className="w-full h-1.5 bg-surface-hover rounded-lg appearance-none cursor-pointer accent-primary"
                                        />
                                    </div>

                                    {/* Rejection Threshold */}
                                    <div>
                                        <div className="flex justify-between mb-1">
                                            <label className="text-xs text-text-secondary">Rejection Threshold</label>
                                            <span className="text-xs font-mono text-primary">{embeddingRejectionThreshold?.toFixed(2) || '0.50'}</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="0.30"
                                            max="0.90"
                                            step="0.01"
                                            value={embeddingRejectionThreshold || 0.50}
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
                    )}

                    {/* Battery saving mode indicator */}
                    {recognitionMode === 'off' && (
                        <div className="flex items-center gap-2 p-2 bg-gray-800/50 rounded-lg border border-gray-600/30">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                                <path d="M11 17a1 1 0 001.447.894l4-2A1 1 0 0017 15V9.236a1 1 0 00-1.447-.894l-4 2a1 1 0 00-.553.894V17zM15.211 6.276a1 1 0 000-1.788l-4.764-2.382a1 1 0 00-.894 0L4.789 4.488a1 1 0 000 1.788l4.764 2.382a1 1 0 00.894 0l4.764-2.382zM4.447 8.342A1 1 0 003 9.236V15a1 1 0 00.553.894l4 2A1 1 0 009 17v-5.764a1 1 0 00-.553-.894l-4-2z" />
                            </svg>
                            <span className="text-xs text-gray-400">Battery saving: audio recording only, transcription later</span>
                        </div>
                    )}
                </div>
            )}
        </header>
    );
};

export default MeetingHeader;
