import { useEffect, useState } from 'react';
import { logger } from '../services/logger';
import { imageGenService } from '../services/image/imageGenService';
import type { SDModelInfo } from 'sd-capacitor';
import { enterActivity, leaveActivity, restoreChatModel } from '../services/model/modelOrchestrator';

export type ImageModelStatus = 'idle' | 'freeing' | 'loading' | 'ready' | 'error';

/**
 * While the image screen is open only Stable Diffusion is in RAM: opening it frees the LLM
 * (and any other heavy model) and loads the image model; closing it frees Stable Diffusion
 * and brings the chat LLM back.
 */
export function useImageModelSession(isOpen: boolean) {
    const [status, setStatus] = useState<ImageModelStatus>('idle');
    const [error, setError] = useState<string | null>(null);
    const [modelInfo, setModelInfo] = useState<SDModelInfo | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        let active = true;
        setStatus('freeing');
        setError(null);
        (async () => {
            try {
                await enterActivity('image', ['sd']);
                if (!active) return;
                setStatus('loading');
                await imageGenService.ensureLoaded();
                const info = await imageGenService.getModelInfo();
                if (active) {
                    setModelInfo(info);
                    setStatus('ready');
                } else {
                    // Closed while the model was loading: do not leave it in RAM
                    await imageGenService.unloadModel();
                    restoreChatModel();
                }
            } catch (e: any) {
                logger.log('warn', '[ImageModelSession] Image model not ready', e);
                if (active) {
                    setStatus('error');
                    setError(e?.message || 'Image model not loaded');
                }
            }
        })();
        return () => {
            active = false;
            setStatus('idle');
            void leaveActivity('image');
        };
    }, [isOpen]);

    /** modelInfo: what the loaded package supports (editing, AI upscaling) */
    return { modelStatus: status, modelError: error, modelInfo };
}
