import React from 'react';
import { CloseIcon, MicrophoneIcon } from '../../constants';
import { SpeechConfig, WhisperLanguage } from '../../types';
import { MeetingSettingsState, resolveLiveLanguage } from '../../hooks/meeting/useMeetingSettings';
import { MeetingDiarizationControls } from './MeetingDiarizationControls';
import { listLocalWhisperModels, WHISPER_MODELS } from '../../services/stt/whisperModelDownloader';

interface MeetingHeaderProps {
    onClose?: () => void;
    onOpenSettings?: () => void;
    onOpenHistory: () => void;
    onNewMeeting?: () => void;
    onImportAudio?: () => void;
    onOpenHelp?: () => void;
    settings: MeetingSettingsState;
    speechConfig?: SpeechConfig;
    activeVoskModel: string | null;
    isVoskLoading: boolean;
    /** Modes can't change mid-recording: the capture was set up for the ones in use. */
    isRecording?: boolean;
    /** An AI provider is set up, so automatic notes can work. */
    aiConfigured?: boolean;
}

const MeetingHeader: React.FC<MeetingHeaderProps> = ({
    onClose,
    onOpenSettings,
    onOpenHistory,
    onNewMeeting,
    onImportAudio,
    onOpenHelp,
    settings,
    activeVoskModel,
    isVoskLoading,
    isRecording = false,
    aiConfigured = false
}) => {
    const {
        recognitionMode,
        setRecognitionMode,
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
        voskItalianModel,
        setVoskItalianModel,
        voskEnglishModel,
        setVoskEnglishModel,
        transcriptionMode,
        setTranscriptionMode,
        whisperProfile,
        setWhisperProfile,
        autoTranscribe,
        setAutoTranscribe,
        postDiarize,
        setPostDiarize,
        whisperModel,
        setWhisperModel,
        autoAnalyze,
        setAutoAnalyze,
        transcribeWhileRecording,
        setTranscribeWhileRecording,
        recognizeVoices,
        setRecognizeVoices,
        embeddingThreshold,
        setEmbeddingThreshold,
        embeddingRejectionThreshold,
        setEmbeddingRejectionThreshold,
        embeddingAdaptationRate,
        setEmbeddingAdaptationRate,
        minEmbeddingMagnitude,
        setMinEmbeddingMagnitude
    } = settings;

    const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
    const [installedWhisperModels, setInstalledWhisperModels] = React.useState<string[]>([]);

    React.useEffect(() => {
        if (!isSettingsOpen) return;
        listLocalWhisperModels().then(setInstalledWhisperModels).catch(() => setInstalledWhisperModels([]));
    }, [isSettingsOpen]);

    return (
        <header className="flex flex-col border-b border-surface bg-background/95 backdrop-blur-md sticky top-0 z-10 transition-shadow shadow-sm">
            {/* Top Row: Navigation & Title */}
            <div className="flex justify-between items-center gap-2 p-4">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 bg-primary/20 rounded-xl hidden sm:block">
                        <MicrophoneIcon className="w-6 h-6 text-primary" />
                    </div>
                    <div className="flex flex-col min-w-0">
                        <h2 className="text-lg font-bold text-white tracking-tight whitespace-nowrap">
                            Meeting Assistant
                        </h2>
                        {/* Compact Status Indicator (Visible when collapsed) */}
                        {!isSettingsOpen && (
                            <div className="flex items-center gap-2 text-[10px] text-text-secondary mt-0.5 animate-fade-in whitespace-nowrap">
                                <span className={`w-1.5 h-1.5 rounded-full ${transcriptionMode === 'off' ? 'bg-gray-500' : 'bg-red-500 animate-pulse'}`}></span>
                                <span className={transcriptionMode === 'vosk' ? 'text-blue-300' : transcriptionMode === 'voxtral' ? 'text-amber-300' : 'text-gray-400'}>
                                    {transcriptionMode === 'off' ? 'Audio Only' : transcriptionMode === 'voxtral' ? 'Voxtral Live' : 'Vosk Live'}
                                </span>
                                <span className="text-white/20">•</span>
                                <span className={recognitionMode === 'precise' ? 'text-purple-300' : recognitionMode === 'fast' ? 'text-blue-300' : 'text-gray-400'}>
                                    {recognitionMode === 'off' ? 'No Diarization' : recognitionMode === 'precise' ? 'Precise Spk' : 'Std Spk'}
                                </span>
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-1.5">
                    {onNewMeeting && (
                        <button
                            onClick={onNewMeeting}
                            className="text-text-secondary hover:text-white p-2 rounded-lg hover:bg-surface transition-colors"
                            title={'New Meeting'}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                            </svg>
                        </button>
                    )}

                    {onImportAudio && (
                        <button
                            onClick={onImportAudio}
                            className="hidden sm:block text-text-secondary hover:text-white p-2 rounded-lg hover:bg-surface transition-colors"
                            title={'Import Audio File'}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                            </svg>
                        </button>
                    )}

                    <button
                        onClick={onOpenHistory}
                        className="text-text-secondary hover:text-white flex items-center gap-1 px-2.5 py-1.5 rounded-lg hover:bg-surface transition-colors text-xs font-medium"
                        title={'History'}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                        </svg>
                        <span className="hidden sm:inline">History</span>
                    </button>

                    <button
                        onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                        className={`text-text-secondary hover:text-white flex items-center gap-1 px-2.5 py-1.5 rounded-lg transition-colors text-xs font-medium border ${isSettingsOpen ? 'bg-surface border-white/10 text-white' : 'border-transparent hover:bg-surface'}`}
                        title={'Audio / Diarization Parameters'}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h6a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                        </svg>
                        <span className="hidden sm:inline">Audio</span>
                    </button>

                    {onOpenHelp && (
                        <button
                            onClick={onOpenHelp}
                            className="text-text-secondary hover:text-white p-2 rounded-lg hover:bg-surface transition-colors"
                            title={'Help & Documentation'}
                        >
                            <span className="w-5 h-5 flex items-center justify-center rounded-full border border-white/20 text-xs font-bold hover:border-white/40">
                                ?
                            </span>
                        </button>
                    )}

                    {onOpenSettings && (
                        <button
                            onClick={onOpenSettings}
                            className="text-text-secondary hover:text-white p-2 rounded-lg hover:bg-surface transition-colors"
                            title={'App Settings'}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                            </svg>
                        </button>
                    )}

                    {onClose && (
                        <button
                            onClick={onClose}
                            className="text-text-secondary hover:text-white p-2 rounded-lg hover:bg-surface transition-colors"
                            title={'Close'}
                        >
                            <CloseIcon className="w-5 h-5" />
                        </button>
                    )}
                </div>
            </div>

            {/* Collapsible Settings Panel */}
            {isSettingsOpen && (
                <fieldset
                    disabled={isRecording}
                    className="min-w-0 px-4 pb-4 space-y-4 animate-fade-in-down border-t border-white/5 pt-4 bg-surface/10 disabled:opacity-60"
                >
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-semibold text-text-primary">Transcription Settings</h3>
                        {isRecording && (
                            <span className="text-[10px] text-amber-300">Locked while recording</span>
                        )}
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
                                title={'No real-time transcription'}
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
                                title={'Vosk (Standard) - Fast, on-device, continuous'}
                            >
                                <div className={`w-1.5 h-1.5 rounded-full ${transcriptionMode === 'vosk' ? 'bg-white' : 'bg-blue-500'}`} />
                                Live (Vosk)
                            </button>
                            <button
                                onClick={() => setTranscriptionMode('voxtral')}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-2 ${transcriptionMode === 'voxtral'
                                    ? 'bg-amber-600/80 text-white shadow-sm ring-1 ring-white/10'
                                    : 'text-text-secondary hover:text-white'
                                    }`}
                                title={'Voxtral - On-device, more accurate, heavier (needs the Voxtral model)'}
                            >
                                <div className={`w-1.5 h-1.5 rounded-full ${transcriptionMode === 'voxtral' ? 'bg-white' : 'bg-amber-500'}`} />
                                Voxtral
                            </button>
                        </div>
                    </div>

                    {/* After recording: on-device Whisper transcript and speakers */}
                    <div className="flex flex-col gap-2 p-3 bg-purple-500/10 rounded-xl border border-purple-500/20">
                        <span className="text-xs font-medium text-purple-200 uppercase tracking-wider">
                            After recording
                        </span>
                        <label className="flex items-center justify-between gap-3 cursor-pointer">
                            <span className="text-xs text-purple-100">Accurate transcript (Whisper, on device)</span>
                            <input type="checkbox" checked={autoTranscribe} onChange={(e) => setAutoTranscribe(e.target.checked)} className="accent-purple-500 w-4 h-4" />
                        </label>
                        <label className={`flex items-center justify-between gap-3 cursor-pointer ${autoTranscribe ? '' : 'opacity-50'}`}>
                            <span className="text-xs text-purple-100">
                                Transcribe while recording
                                <span className="block text-[10px] text-purple-200/60">Ready soon after you stop; uses more battery</span>
                            </span>
                            <input type="checkbox" checked={transcribeWhileRecording} disabled={!autoTranscribe} onChange={(e) => setTranscribeWhileRecording(e.target.checked)} className="accent-purple-500 w-4 h-4" />
                        </label>
                        <label className="flex items-center justify-between gap-3 cursor-pointer">
                            <span className="text-xs text-purple-100">Identify speakers</span>
                            <input type="checkbox" checked={postDiarize} onChange={(e) => setPostDiarize(e.target.checked)} className="accent-purple-500 w-4 h-4" />
                        </label>
                        <label className={`flex items-center justify-between gap-3 cursor-pointer ${postDiarize ? '' : 'opacity-50'}`}>
                            <span className="text-xs text-purple-100">
                                Recognize known voices
                                <span className="block text-[10px] text-purple-200/60">People you named before get their name; voices stay on the phone</span>
                            </span>
                            <input type="checkbox" checked={recognizeVoices} disabled={!postDiarize} onChange={(e) => setRecognizeVoices(e.target.checked)} className="accent-purple-500 w-4 h-4" />
                        </label>
                        <label className="flex items-center justify-between gap-3 cursor-pointer">
                            <span className="text-xs text-purple-100">
                                AI notes (summary, decisions, tasks)
                                <span className="block text-[10px] text-purple-200/60">
                                    {aiConfigured ? 'Sends the transcript to your AI provider' : 'Set up an AI provider in Settings first'}
                                </span>
                            </span>
                            <input type="checkbox" checked={autoAnalyze} onChange={(e) => setAutoAnalyze(e.target.checked)} className="accent-purple-500 w-4 h-4" />
                        </label>
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-xs text-purple-100">Model</span>
                            <select
                                value={installedWhisperModels.includes(whisperModel) ? whisperModel : 'auto'}
                                onChange={(e) => setWhisperModel(e.target.value)}
                                className="bg-surface text-text-primary text-xs rounded-lg px-2.5 py-1.5 border border-white/10 focus:ring-1 focus:ring-primary focus:outline-none max-w-[210px]"
                                title={'Auto uses Small (recommended) or the bundled Base. Large v3 Turbo is the most accurate but slower than real time. Download models in Settings → Models.'}
                            >
                                <option value="auto">Auto (Small if installed)</option>
                                {installedWhisperModels.map(id => (
                                    <option key={id} value={id}>{WHISPER_MODELS.find(m => m.id === id)?.name ?? id}</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-purple-100">Quality</span>
                            <div className="flex bg-surface rounded-lg p-1 border border-white/5">
                                <button
                                    onClick={() => setWhisperProfile('fast')}
                                    className={`px-2 py-1 rounded-md text-xs font-medium transition-all ${whisperProfile === 'fast' ? 'bg-purple-500 text-white shadow-sm' : 'text-text-secondary hover:text-white'}`}
                                    title={'Greedy decoding: about 8x faster than real time'}
                                >
                                    Fast
                                </button>
                                <button
                                    onClick={() => setWhisperProfile('accurate')}
                                    className={`px-2 py-1 rounded-md text-xs font-medium transition-all ${whisperProfile === 'accurate' ? 'bg-purple-500 text-white shadow-sm' : 'text-text-secondary hover:text-white'}`}
                                    title={'Beam search: more accurate, about 1.5x slower'}
                                >
                                    Accurate
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Speaker ID Mode Selector */}
                    <div className={`flex items-center justify-between ${transcriptionMode === 'off' ? 'opacity-50' : ''}`}>
                        <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">
                            Live Speakers
                        </span>
                        <div className="flex bg-surface rounded-lg p-1 border border-white/5">
                            <button
                                onClick={() => setRecognitionMode('off')}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-2 ${recognitionMode === 'off'
                                    ? 'bg-gray-600 text-white shadow-sm'
                                    : 'text-text-secondary hover:text-white'
                                    }`}
                                title={'No speaker recognition - Audio recording only'}
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
                                title={transcriptionMode === 'off' ? 'Available only with transcription' : 'Vosk Embeddings - Fast speaker recognition, less precise'}
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
                                title={transcriptionMode === 'off' ? 'Available only with transcription' : 'ONNX ECAPA Embeddings - Precise speaker recognition, requires ONNX model'}
                            >
                                <div className="w-2 h-2 rounded-full bg-purple-300" />
                                Precise
                            </button>
                        </div>
                    </div>

                    {/* Language & Model Selector */}
                    {(
                        <div className="flex flex-col gap-2.5 p-3 bg-surface/30 rounded-xl border border-white/5">
                            {/* Language Row */}
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">
                                    Language
                                </span>
                                <div className="flex items-center gap-2">
                                    <select
                                        value={transcriptionLanguage}
                                        onChange={(e) => setTranscriptionLanguage(e.target.value as WhisperLanguage)}
                                        className="bg-surface text-text-primary text-xs rounded-lg px-3 py-1.5 border border-white/10 focus:ring-1 focus:ring-primary focus:outline-none"
                                        title={'Transcription language. Auto: Whisper detects it; live Vosk uses the phone\'s language.'}
                                    >
                                        <option value="auto">Auto</option>
                                        <option value="it">Italian (it)</option>
                                        <option value="en">English (en)</option>
                                    </select>
                                </div>
                            </div>

                            {/* Vosk Model Variant Selector */}
                            {transcriptionMode === 'vosk' && (
                                <div className="flex items-center justify-between pt-2 border-t border-white/5">
                                    <span className="text-xs font-medium text-text-secondary">
                                        Vosk Model
                                    </span>
                                    {resolveLiveLanguage(transcriptionLanguage) === 'it' ? (
                                        <select
                                            value={voskItalianModel}
                                            onChange={(e) => setVoskItalianModel(e.target.value)}
                                            className="bg-surface text-text-primary text-xs rounded-lg px-2.5 py-1.5 border border-white/10 focus:ring-1 focus:ring-primary focus:outline-none max-w-[210px]"
                                            title={'Italian Vosk Model Variant'}
                                        >
                                            <option value="vosk-model-small-it-0.22">Lightweight (Small ~49MB)</option>
                                            <option value="vosk-model-it-0.22">High Precision (Large ~1.4GB)</option>
                                        </select>
                                    ) : (
                                        <select
                                            value={voskEnglishModel}
                                            onChange={(e) => setVoskEnglishModel(e.target.value)}
                                            className="bg-surface text-text-primary text-xs rounded-lg px-2.5 py-1.5 border border-white/10 focus:ring-1 focus:ring-primary focus:outline-none max-w-[210px]"
                                            title={'English Vosk Model Variant'}
                                        >
                                            <option value="vosk-model-small-en-us-0.15">Lightweight (Small ~41MB)</option>
                                            <option value="vosk-model-en-us-0.22-lgraph">Standard (Accurate ~130MB)</option>
                                        </select>
                                    )}
                                </div>
                            )}

                            {/* Active Model Indicator Badge */}
                            {transcriptionMode === 'vosk' && <div className="flex items-center justify-between pt-2 border-t border-white/5 text-[11px]">
                                <span className="text-text-secondary font-medium">Active STT Model:</span>
                                <div className="flex items-center gap-1.5 font-mono text-xs">
                                    <span className={`w-2 h-2 rounded-full ${isVoskLoading ? 'bg-amber-400 animate-ping' : 'bg-green-400'}`}></span>
                                    <span className="text-text-primary font-medium truncate max-w-[220px]">
                                        {isVoskLoading ? 'Loading model...' : (activeVoskModel || (resolveLiveLanguage(transcriptionLanguage) === 'it' ? voskItalianModel : voskEnglishModel))}
                                    </span>
                                </div>
                            </div>}
                        </div>
                    )}

                    {/* Diarization Sliders and Advanced Controls */}
                    <MeetingDiarizationControls
                        recognitionMode={recognitionMode}
                        diarizationSensitivity={diarizationSensitivity}
                        setDiarizationSensitivity={setDiarizationSensitivity}
                        temporalSmoothing={temporalSmoothing}
                        setTemporalSmoothing={setTemporalSmoothing}
                        embeddingDuration={embeddingDuration}
                        setEmbeddingDuration={setEmbeddingDuration}
                        targetSpeakerCount={targetSpeakerCount}
                        setTargetSpeakerCount={setTargetSpeakerCount}
                        clusteringAlgorithm={clusteringAlgorithm}
                        setClusteringAlgorithm={setClusteringAlgorithm}
                        embeddingThreshold={embeddingThreshold}
                        setEmbeddingThreshold={setEmbeddingThreshold}
                        embeddingRejectionThreshold={embeddingRejectionThreshold}
                        setEmbeddingRejectionThreshold={setEmbeddingRejectionThreshold}
                        embeddingAdaptationRate={embeddingAdaptationRate}
                        setEmbeddingAdaptationRate={setEmbeddingAdaptationRate}
                        minEmbeddingMagnitude={minEmbeddingMagnitude}
                        setMinEmbeddingMagnitude={setMinEmbeddingMagnitude}
                    />

                    {/* Battery saving mode indicator */}
                    {recognitionMode === 'off' && (
                        <div className="flex items-center gap-2 p-2 bg-gray-800/50 rounded-lg border border-gray-600/30">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                                <path d="M11 17a1 1 0 001.447.894l4-2A1 1 0 0017 15V9.236a1 1 0 00-1.447-.894l-4 2a1 1 0 00-.553.894V17zM15.211 6.276a1 1 0 000-1.788l-4.764-2.382a1 1 0 00-.894 0L4.789 4.488a1 1 0 000 1.788l4.764 2.382a1 1 0 00.894 0l4.764-2.382zM4.447 8.342A1 1 0 003 9.236V15a1 1 0 00.553.894l4 2A1 1 0 009 17v-5.764a1 1 0 00-.553-.894l-4-2z" />
                            </svg>
                            <span className="text-xs text-gray-400">Battery saving: audio recording only, transcription later</span>
                        </div>
                    )}
                </fieldset>
            )}
        </header>
    );
};

export default MeetingHeader;
