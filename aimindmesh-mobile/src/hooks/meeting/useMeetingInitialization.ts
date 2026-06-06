import { useState, useEffect } from 'react';
import { Vosk } from 'vosk-capacitor';
import { SpeakerEmbedding as SpeakerEmbeddingPlugin } from 'speaker-embedding-capacitor';
import { logger } from '../../services/logger';
import { getWhisperSTTService } from '../../services/stt/whisperSTT';
import { MeetingSettingsState } from './useMeetingSettings';

interface UseMeetingInitializationProps {
    settings: MeetingSettingsState;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    transcript: any[]; // Depencency for effect
    currentText: string; // Dependency for effect
}

export function useMeetingInitialization({
    settings,
    showToast,
    transcript,
    currentText
}: UseMeetingInitializationProps) {
    const [isModelLoading, setIsModelLoading] = useState(false);

    // Init and Model Loading
    useEffect(() => {
        const init = async () => {
            // Permission check for Vosk/Recorder
            try {
                const status = await (Vosk as any).checkPermissions();
                if (status.microphone !== 'granted') {
                    await (Vosk as any).requestPermissions();
                }
            } catch (e) {
                console.warn('Vosk permission check failed:', e);
            }

            // ONNX Speaker Model Loading
            if (settings.recognitionMode === 'precise') {
                try {
                    const status = await SpeakerEmbeddingPlugin.isModelLoaded();
                    if (!status.loaded) {
                        logger.log('info', 'Loading ONNX speaker model...');
                        await SpeakerEmbeddingPlugin.loadModel({ modelPath: 'models/ecapa_tdnn.onnx' });
                        logger.log('info', 'ONNX speaker model loaded');
                    }
                } catch (e) {
                    logger.log('error', 'Failed to load ONNX model on init', e);
                }
            }
        };

        init();
    }, [transcript, currentText, settings.recognitionMode]);

    // Pre-load Whisper Model when mode changes
    useEffect(() => {
        const loadWhisperModel = async () => {
            if (settings.transcriptionMode === 'whisper') {
                setIsModelLoading(true);
                showToast('Loading Whisper model...', 'info');
                try {
                    const service = getWhisperSTTService();
                    const isLoaded = await service.checkModelLoaded();
                    if (!isLoaded) {
                        await service.loadModel('ggml-base');
                    }
                    setIsModelLoading(false);
                    showToast('Whisper model loaded', 'success');
                } catch (error) {
                    logger.log('error', 'Failed to load Whisper model', error);
                    setIsModelLoading(false);
                    showToast('Failed to load Whisper model', 'error');
                }
            } else {
                setIsModelLoading(false); // Should we unload? Probably not for responsiveness
            }
        };

        loadWhisperModel();
    }, [settings.transcriptionMode, showToast]);

    return {
        isModelLoading
    };
}
