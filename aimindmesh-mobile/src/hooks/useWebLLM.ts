import { useState, useCallback } from 'react';
import * as webLLM from '../services/llm/webLLM';
import { logger } from '../services/logger';

export type WebLLMStatus = 'Idle' | 'Loading' | 'Ready' | 'Error';

export interface UseWebLLMResult {
    status: WebLLMStatus;
    progress: number;
    progressText: string;
    error: string | null;
    loadModel: (modelId: string) => void;
    unload: () => Promise<void>;
}

export const useWebLLM = (): UseWebLLMResult => {
    const [status, setStatus] = useState<WebLLMStatus>(webLLM.isReady() ? 'Ready' : 'Idle');
    const [progress, setProgress] = useState(0);
    const [progressText, setProgressText] = useState('');
    const [error, setError] = useState<string | null>(null);

    const loadModel = useCallback((modelId: string) => {
        if (status === 'Loading') return;

        logger.log('info', 'Loading WebLLM model', { modelId });
        setStatus('Loading');
        setProgress(0);
        setProgressText('Initializing...');
        setError(null);

        const onProgress = (p: number, text: string) => {
            logger.log('debug', `Loading WebLLM: ${text} (${p.toFixed(2)}%)`);
            setProgress(Number(p.toFixed(2)));
            setProgressText(text);
        };

        webLLM.init(modelId, onProgress)
            .then(() => {
                setStatus('Ready');
                setProgress(100);
                setProgressText('Model ready');
            })
            .catch((e) => {
                logger.log('error', 'Failed to initialize WebLLM engine', e);
                setError(e.message || "An unknown error occurred during initialization.");
                setStatus('Error');
                setProgressText('Failed to load');
            });
    }, [status]);

    const unload = useCallback(async () => {
        if (status === 'Idle') return;
        await webLLM.unload();
        setStatus('Idle');
        setProgress(0);
        setProgressText('');
    }, [status]);

    return { status, progress, progressText, error, loadModel, unload };
};