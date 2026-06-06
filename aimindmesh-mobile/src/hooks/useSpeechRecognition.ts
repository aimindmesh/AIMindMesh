
import { useState, useCallback, useEffect } from 'react';
import { getOfflineSttService, getOnlineSttService } from '../services/tts/speech';
import { SpeechProvider } from '../types';
import { logger } from '../services/logger';

export interface UseSpeechRecognitionResult {
    isListening: boolean;
    startListening: () => void;
    stopListening: () => void;
    isSupported: boolean;
}

/**
 * A custom hook to manage speech recognition state based on a selected provider.
 * @param onTranscriptUpdate A callback function that receives the live transcript.
 * @param provider The selected speech provider ('offline' | 'online').
 * @param apiKey The Gemini API key (required for online provider).
 * @returns An object with listening state and control functions.
 */
export const useSpeechRecognition = (onTranscriptUpdate: (text: string) => void, provider: SpeechProvider, apiKey?: string): UseSpeechRecognitionResult => {
    const [isListening, setIsListening] = useState(false);

    const service = provider === 'offline' ? getOfflineSttService() : getOnlineSttService();

    // This effect manages the lifecycle of the speech recognition service.
    // It starts the service when isListening becomes true, and returns a
    // cleanup function that stops the service.
    useEffect(() => {
        if (!isListening) {
            return;
        }

        logger.log('info', `Starting speech recognition with ${provider} provider.`);
        if (provider === 'online') {
            getOnlineSttService().start(onTranscriptUpdate, apiKey);
        } else {
            getOfflineSttService().start(onTranscriptUpdate);
        }

        // The cleanup function will be called when isListening becomes false,
        // or when the component unmounts.
        return () => {
            logger.log('info', `Stopping speech recognition with ${provider} provider.`);
            service.stop();
        };
    }, [isListening, provider, onTranscriptUpdate, service, apiKey]);

    const startListening = useCallback(() => {
        if (!service.isSupported()) {
            const message = "The selected speech recognition provider is not available. For 'Online', please ensure your API key is configured.";
            logger.log('warn', message);
            alert(message);
            return;
        }
        setIsListening(true);
    }, [service]);

    const stopListening = useCallback(() => {
        setIsListening(false);
    }, []);

    return {
        isListening,
        startListening: startListening,
        stopListening: stopListening,
        isSupported: service.isSupported(),
    };
};