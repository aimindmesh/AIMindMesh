import { useState, useEffect, useRef } from 'react';
import { ClusteringAlgorithm, WhisperLanguage } from '../../types';
import { RecognitionMode, TranscriptionMode } from '../../types/meeting';

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
    transcriptionMode: TranscriptionMode;
    setTranscriptionMode: (mode: TranscriptionMode) => void;
    whisperChunkSize: number;
    setWhisperChunkSize: (value: number) => void;
    whisperVadFilter: boolean;
    setWhisperVadFilter: (value: boolean) => void;
    whisperConditionOnPrevious: boolean;
    setWhisperConditionOnPrevious: (value: boolean) => void;
    whisperWordTimestamps: boolean;
    setWhisperWordTimestamps: (value: boolean) => void;
    whisperProfile: 'fast' | 'accurate';
    setWhisperProfile: (value: 'fast' | 'accurate') => void;
    // Refs for callbacks that need current values
    recognitionModeRef: React.MutableRefObject<RecognitionMode>;
    embeddingDurationRef: React.MutableRefObject<number>;
}

/**
 * Hook for managing meeting settings with localStorage persistence
 */
export function useMeetingSettings(): MeetingSettingsState {
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
        return saved ? parseFloat(saved) : 0.80;
    });

    const [embeddingRejectionThreshold, setEmbeddingRejectionThreshold] = useState(() => {
        const saved = localStorage.getItem('embedding-rejection-threshold');
        return saved ? parseFloat(saved) : 0.50;
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

    const [transcriptionMode, setTranscriptionMode] = useState<TranscriptionMode>(() => {
        const saved = localStorage.getItem('transcription-mode');
        return (saved as TranscriptionMode) || 'vosk';
    });

    const [whisperChunkSize, setWhisperChunkSize] = useState(() => {
        const saved = localStorage.getItem('whisper-chunk-size');
        return saved ? parseInt(saved) : 10;
    });

    const [whisperVadFilter, setWhisperVadFilter] = useState(() => {
        return localStorage.getItem('whisper-vad-filter') === 'true';
    });

    const [whisperConditionOnPrevious, setWhisperConditionOnPrevious] = useState(() => {
        return localStorage.getItem('whisper-condition-previous') === 'true';
    });

    const [whisperWordTimestamps, setWhisperWordTimestamps] = useState(() => {
        return localStorage.getItem('whisper-word-timestamps') === 'true';
    });

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
        localStorage.setItem('transcription-mode', transcriptionMode);
    }, [transcriptionMode]);

    useEffect(() => {
        localStorage.setItem('whisper-chunk-size', whisperChunkSize.toString());
    }, [whisperChunkSize]);

    useEffect(() => {
        localStorage.setItem('whisper-vad-filter', whisperVadFilter.toString());
    }, [whisperVadFilter]);

    useEffect(() => {
        localStorage.setItem('whisper-condition-previous', whisperConditionOnPrevious.toString());
    }, [whisperConditionOnPrevious]);

    useEffect(() => {
        localStorage.setItem('whisper-word-timestamps', whisperWordTimestamps.toString());
    }, [whisperWordTimestamps]);

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
        transcriptionMode,
        setTranscriptionMode,
        whisperChunkSize,
        setWhisperChunkSize,
        whisperVadFilter,
        setWhisperVadFilter,
        whisperConditionOnPrevious,
        setWhisperConditionOnPrevious,
        whisperWordTimestamps,
        setWhisperWordTimestamps,
        whisperProfile,
        setWhisperProfile,
        recognitionModeRef,
        embeddingDurationRef
    };
}

