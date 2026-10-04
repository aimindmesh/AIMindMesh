import { useState, useEffect, useRef } from 'react';
import { ClusteringAlgorithm, WhisperLanguage } from '../../types';
import { RecognitionMode, TranscriptionMode } from '../../types/meeting';
import type { SpeakerOptions, TranscribeOptions } from '../../services/meeting/postProcessing/pipeline';
import { LIVE_MATCH_THRESHOLD, LIVE_REJECTION_THRESHOLD, migrateSpeakerCalibration } from '../../services/speaker/speakerCalibration';

export interface MeetingSettingsState {
    recognitionMode: RecognitionMode;
    setRecognitionMode: (mode: RecognitionMode) => void;
    diarizationSensitivity: number;
    setDiarizationSensitivity: (value: number) => void;
    temporalSmoothing: number;
    setTemporalSmoothing: (value: number) => void;
    embeddingDuration: number;
    setEmbeddingDuration: (value: number) => void;

    // Advanced Diarization
    embeddingThreshold: number;
    setEmbeddingThreshold: (value: number) => void;
    embeddingRejectionThreshold: number;
    setEmbeddingRejectionThreshold: (value: number) => void;
    embeddingAdaptationRate: number;
    setEmbeddingAdaptationRate: (value: number) => void;
    minEmbeddingMagnitude: number;
    setMinEmbeddingMagnitude: (value: number) => void;
    targetSpeakerCount: number | undefined;
    setTargetSpeakerCount: (value: number | undefined) => void;
    clusteringAlgorithm: ClusteringAlgorithm;
    setClusteringAlgorithm: (value: ClusteringAlgorithm) => void;
    transcriptionLanguage: WhisperLanguage;
    setTranscriptionLanguage: (value: WhisperLanguage) => void;
    voskItalianModel: string;
    setVoskItalianModel: (modelId: string) => void;
    voskEnglishModel: string;
    setVoskEnglishModel: (modelId: string) => void;
    transcriptionMode: TranscriptionMode;
    setTranscriptionMode: (mode: TranscriptionMode) => void;
    /** Whisper decoding after recording: greedy (fast) or beam search (accurate). */
    whisperProfile: 'fast' | 'accurate';
    setWhisperProfile: (value: 'fast' | 'accurate') => void;
    /** Run the on-device Whisper transcript automatically when a recording stops. */
    autoTranscribe: boolean;
    setAutoTranscribe: (value: boolean) => void;
    /** Identify speakers in the after-recording transcript. */
    postDiarize: boolean;
    setPostDiarize: (value: boolean) => void;
    /** Whisper model for the after-recording transcript, or 'auto' (most accurate installed). */
    whisperModel: string;
    setWhisperModel: (value: string) => void;
    /** With autoTranscribe: transcribe finished speech while recording, so the transcript is ready soon after stop. */
    transcribeWhileRecording: boolean;
    setTranscribeWhileRecording: (value: boolean) => void;
    /** Name speakers whose voice was named in earlier meetings, and remember voices the user names. */
    recognizeVoices: boolean;
    setRecognizeVoices: (value: boolean) => void;
    /** Ask the configured AI for notes once the transcript is final (sends it to the provider). */
    autoAnalyze: boolean;
    setAutoAnalyze: (value: boolean) => void;
    // Refs for callbacks that need current values
    recognitionModeRef: React.MutableRefObject<RecognitionMode>;
    embeddingDurationRef: React.MutableRefObject<number>;
}

/** Speaker identification options from the settings. */
export function speakerOptionsFrom(settings: MeetingSettingsState): SpeakerOptions {
    return { distanceThreshold: 1 - settings.diarizationSensitivity, targetSpeakers: settings.targetSpeakerCount };
}

/** Whisper options for a meeting's accurate transcript, from the settings. */
export function transcribeOptionsFrom(settings: MeetingSettingsState): TranscribeOptions {
    return {
        language: settings.transcriptionLanguage,
        accurate: settings.whisperProfile === 'accurate',
        model: settings.whisperModel,
        diarize: settings.postDiarize,
        speakers: speakerOptionsFrom(settings)
    };
}

/**
 * Language for live Vosk, which needs a concrete model: 'auto' follows the phone's language
 * (Italian or English). Whisper handles 'auto' itself.
 */
export function resolveLiveLanguage(language: WhisperLanguage): 'it' | 'en' {
    if (language === 'it' || language === 'en') return language;
    return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('it') ? 'it' : 'en';
}

/** Live transcription modes still offered (the old live Whisper and Hybrid became the Whisper pass). */
export function migrateTranscriptionMode(saved: string | null): TranscriptionMode {
    if (saved === 'off' || saved === 'voxtral') return saved;
    return 'vosk';
}

/**
 * Hook for managing meeting settings with localStorage persistence
 */
export function useMeetingSettings(): MeetingSettingsState {
    // Once per install (also run at startup): old thresholds dropped, see speakerCalibration
    migrateSpeakerCalibration();

    const [recognitionMode, setRecognitionMode] = useState<RecognitionMode>(() => {
        const saved = localStorage.getItem('recognition-mode');
        if (saved === 'off') return 'off';
        return (saved === 'precise' ? 'precise' : 'fast');
    });

    const [diarizationSensitivity, setDiarizationSensitivity] = useState(() => {
        const saved = localStorage.getItem('diarization-sensitivity');
        return saved ? parseFloat(saved) : 0.55;
    });

    const [temporalSmoothing, setTemporalSmoothing] = useState(() => {
        const saved = localStorage.getItem('temporal-smoothing');
        return saved ? parseInt(saved) : 2000;
    });

    const [embeddingDuration, setEmbeddingDuration] = useState(() => {
        const saved = localStorage.getItem('embedding-duration');
        return saved ? parseFloat(saved) : 4.0;
    });

    const [embeddingThreshold, setEmbeddingThreshold] = useState(() => {
        const saved = localStorage.getItem('embedding-threshold');
        return saved ? parseFloat(saved) : LIVE_MATCH_THRESHOLD;
    });

    const [embeddingRejectionThreshold, setEmbeddingRejectionThreshold] = useState(() => {
        const saved = localStorage.getItem('embedding-rejection-threshold');
        return saved ? parseFloat(saved) : LIVE_REJECTION_THRESHOLD;
    });

    const [embeddingAdaptationRate, setEmbeddingAdaptationRate] = useState(() => {
        const saved = localStorage.getItem('embedding-adaptation-rate');
        return saved ? parseFloat(saved) : 0.03;
    });

    const [minEmbeddingMagnitude, setMinEmbeddingMagnitude] = useState(() => {
        const saved = localStorage.getItem('min-embedding-magnitude');
        return saved ? parseFloat(saved) : 0.50;
    });

    const [targetSpeakerCount, setTargetSpeakerCount] = useState<number | undefined>(() => {
        const saved = localStorage.getItem('target-speaker-count');
        return saved && saved !== 'auto' ? parseInt(saved) : undefined;
    });

    const [clusteringAlgorithm, setClusteringAlgorithm] = useState<ClusteringAlgorithm>(() => {
        const saved = localStorage.getItem('clustering-algorithm');
        return (saved as ClusteringAlgorithm) || 'ahc';
    });

    const [transcriptionLanguage, setTranscriptionLanguage] = useState<WhisperLanguage>(() => {
        const saved = localStorage.getItem('transcription-language');
        return (saved as WhisperLanguage) || 'auto';
    });

    const [voskItalianModel, setVoskItalianModel] = useState<string>(() => {
        return localStorage.getItem('vosk-italian-model') || 'vosk-model-small-it-0.22';
    });

    const [voskEnglishModel, setVoskEnglishModel] = useState<string>(() => {
        return localStorage.getItem('vosk-english-model') || 'vosk-model-small-en-us-0.15';
    });

    const [transcriptionMode, setTranscriptionMode] = useState<TranscriptionMode>(() =>
        migrateTranscriptionMode(localStorage.getItem('transcription-mode')));

    const [autoTranscribe, setAutoTranscribe] = useState(() => localStorage.getItem('auto-transcribe') !== 'false');

    const [postDiarize, setPostDiarize] = useState(() => localStorage.getItem('post-diarize') !== 'false');

    const [whisperModel, setWhisperModel] = useState(() => localStorage.getItem('whisper-model') || 'auto');
    const [transcribeWhileRecording, setTranscribeWhileRecording] = useState(() => localStorage.getItem('transcribe-while-recording') !== 'false');
    const [recognizeVoices, setRecognizeVoices] = useState(() => localStorage.getItem('recognize-voices') !== 'false');
    // Off by default: it sends the transcript to a cloud provider
    const [autoAnalyze, setAutoAnalyze] = useState(() => localStorage.getItem('auto-analyze') === 'true');

    const [whisperProfile, setWhisperProfile] = useState<'fast' | 'accurate'>(() => {
        const saved = localStorage.getItem('whisper-profile');
        return (saved === 'accurate' ? 'accurate' : 'fast');
    });

    // Refs for use in callbacks
    const recognitionModeRef = useRef(recognitionMode);
    const embeddingDurationRef = useRef(embeddingDuration);

    // Persist settings
    useEffect(() => {
        localStorage.setItem('recognition-mode', recognitionMode);
        recognitionModeRef.current = recognitionMode;
    }, [recognitionMode]);

    useEffect(() => {
        localStorage.setItem('diarization-sensitivity', diarizationSensitivity.toString());
    }, [diarizationSensitivity]);

    useEffect(() => {
        localStorage.setItem('temporal-smoothing', temporalSmoothing.toString());
    }, [temporalSmoothing]);

    useEffect(() => {
        localStorage.setItem('embedding-threshold', embeddingThreshold.toString());
    }, [embeddingThreshold]);

    useEffect(() => {
        localStorage.setItem('embedding-rejection-threshold', embeddingRejectionThreshold.toString());
    }, [embeddingRejectionThreshold]);

    useEffect(() => {
        localStorage.setItem('embedding-adaptation-rate', embeddingAdaptationRate.toString());
    }, [embeddingAdaptationRate]);

    useEffect(() => {
        localStorage.setItem('min-embedding-magnitude', minEmbeddingMagnitude.toString());
    }, [minEmbeddingMagnitude]);

    useEffect(() => {
        localStorage.setItem('embedding-duration', embeddingDuration.toString());
        embeddingDurationRef.current = embeddingDuration;
    }, [embeddingDuration]);

    useEffect(() => {
        localStorage.setItem('target-speaker-count', targetSpeakerCount !== undefined ? targetSpeakerCount.toString() : 'auto');
    }, [targetSpeakerCount]);

    useEffect(() => {
        localStorage.setItem('clustering-algorithm', clusteringAlgorithm);
    }, [clusteringAlgorithm]);

    useEffect(() => {
        localStorage.setItem('transcription-language', transcriptionLanguage);
    }, [transcriptionLanguage]);

    useEffect(() => {
        localStorage.setItem('vosk-italian-model', voskItalianModel);
    }, [voskItalianModel]);

    useEffect(() => {
        localStorage.setItem('vosk-english-model', voskEnglishModel);
    }, [voskEnglishModel]);

    useEffect(() => {
        localStorage.setItem('transcription-mode', transcriptionMode);
    }, [transcriptionMode]);

    useEffect(() => {
        localStorage.setItem('auto-transcribe', autoTranscribe.toString());
    }, [autoTranscribe]);

    useEffect(() => {
        localStorage.setItem('post-diarize', postDiarize.toString());
    }, [postDiarize]);

    useEffect(() => {
        localStorage.setItem('whisper-model', whisperModel);
    }, [whisperModel]);

    useEffect(() => {
        localStorage.setItem('auto-analyze', autoAnalyze.toString());
    }, [autoAnalyze]);

    useEffect(() => {
        localStorage.setItem('transcribe-while-recording', transcribeWhileRecording.toString());
    }, [transcribeWhileRecording]);

    useEffect(() => {
        localStorage.setItem('recognize-voices', recognizeVoices.toString());
    }, [recognizeVoices]);

    useEffect(() => {
        localStorage.setItem('whisper-profile', whisperProfile);
    }, [whisperProfile]);

    // Enforce dependency: If transcription is off, speaker recognition must be off
    useEffect(() => {
        if (transcriptionMode === 'off' && recognitionMode !== 'off') {
            setRecognitionMode('off');
        }
    }, [transcriptionMode, recognitionMode]);

    return {
        recognitionMode,
        setRecognitionMode,
        diarizationSensitivity,
        setDiarizationSensitivity,
        temporalSmoothing,
        setTemporalSmoothing,
        embeddingThreshold,
        setEmbeddingThreshold,
        embeddingRejectionThreshold,
        setEmbeddingRejectionThreshold,
        embeddingAdaptationRate,
        setEmbeddingAdaptationRate,
        minEmbeddingMagnitude,
        setMinEmbeddingMagnitude,
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
        recognitionModeRef,
        embeddingDurationRef
    };
}

