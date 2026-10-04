import { useState, useEffect } from 'react';
import { SpeakerEmbedding as SpeakerEmbeddingPlugin } from 'speaker-embedding-capacitor';
import { logger } from '../../services/logger';
import { waitForBundledModels } from '../../services/model/bundledModels';
import { SpeechConfig } from '../../types';
import { MeetingSettingsState, resolveLiveLanguage } from './useMeetingSettings';

interface UseMeetingInitializationProps {
    settings: MeetingSettingsState;
    /** App speech settings: the Voxtral model and its options */
    speechConfig?: SpeechConfig;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

/**
 * Loads the models live recording needs. Everything waits for the bundled models to be
 * unpacked first: on the first launch that takes about a minute, and loading earlier failed.
 * (Whisper, VAD and the post-recording models are loaded on demand by the post-processing.)
 * Meetings load their live models themselves: they no longer depend on voice mode having
 * loaded them first.
 */
export function useMeetingInitialization({
    settings,
    speechConfig,
    showToast
}: UseMeetingInitializationProps) {
    const [modelsReady, setModelsReady] = useState(false);
    const [activeVoskModel, setActiveVoskModel] = useState<string | null>(null);
    const [isVoskLoading, setIsVoskLoading] = useState<boolean>(false);

    useEffect(() => {
        let cancelled = false;
        waitForBundledModels()
            .then(() => { if (!cancelled) setModelsReady(true); })
            .catch(e => {
                logger.log('error', 'Bundled models unavailable', e);
                showToast('Speech models could not be prepared: reinstall the app if this persists', 'error');
            });
        return () => { cancelled = true; };
    }, [showToast]);

    // ONNX speaker model for live "precise" speaker recognition
    useEffect(() => {
        if (!modelsReady || settings.recognitionMode !== 'precise') return;
        (async () => {
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
        })();
    }, [modelsReady, settings.recognitionMode]);

    // Pre-load / hot-swap Vosk Model when mode, language, or model variant changes
    useEffect(() => {
        let isCancelled = false;

        const loadVoskModel = async () => {
            if (!modelsReady || settings.transcriptionMode !== 'vosk') return;
            try {
                const { getVoskSttService } = await import('../../services/stt/voskSTT');
                const service = getVoskSttService();

                const lang = resolveLiveLanguage(settings.transcriptionLanguage);
                let targetModel = (lang === 'it')
                    ? (settings.voskItalianModel || 'vosk-model-small-it-0.22')
                    : (settings.voskEnglishModel || 'vosk-model-small-en-us-0.15');

                try {
                    const { listLocalVoskModels } = await import('../../services/stt/voskModelDownloader');
                    const installed = await listLocalVoskModels();
                    if (installed.length > 0 && !installed.includes(targetModel)) {
                        targetModel = installed.find(m => m.includes(lang === 'it' ? '-it-' : '-en-')) || installed[0];
                    }
                } catch (e) {
                    logger.log('warn', 'Could not query installed Vosk models', e);
                }

                if (!service.isModelLoaded() || service.getCurrentModelId() !== targetModel) {
                    setIsVoskLoading(true);
                    logger.log('info', `Loading/Switching Vosk model: ${targetModel}`);
                    await service.loadModel(targetModel);
                    if (!isCancelled) {
                        setActiveVoskModel(targetModel);
                        logger.log('info', `Vosk model loaded: ${targetModel}`);
                    }
                } else if (!isCancelled) {
                    setActiveVoskModel(service.getCurrentModelId());
                }
            } catch (e) {
                logger.log('warn', 'Failed to load Vosk model', e);
            } finally {
                if (!isCancelled) setIsVoskLoading(false);
            }
        };

        loadVoskModel();

        return () => {
            isCancelled = true;
        };
    }, [
        modelsReady,
        settings.transcriptionMode,
        settings.transcriptionLanguage,
        settings.voskItalianModel,
        settings.voskEnglishModel
    ]);

    // Voxtral live transcription: the meeting loads the model (heavy: the orchestrator frees the LLM)
    useEffect(() => {
        if (!modelsReady || settings.transcriptionMode !== 'voxtral') return;
        let isCancelled = false;
        (async () => {
            try {
                const { getVoxtralSttService } = await import('../../services/stt/voxtralSTT');
                const service = getVoxtralSttService();
                let modelPath = speechConfig?.voxtralModel;
                if (!modelPath) {
                    const { listLocalVoxtralModels } = await import('../../services/stt/voxtralModelDownloader');
                    modelPath = (await listLocalVoxtralModels())[0];
                }
                if (!modelPath) {
                    showToast('No Voxtral model installed (Settings → Speech): recording will use audio only', 'info');
                    return;
                }
                if (service.checkModelLoaded() && service.getCurrentModelPath() === modelPath) return;
                setIsVoskLoading(true);
                await service.loadModel({
                    modelPath,
                    transcriptionDelayMs: speechConfig?.voxtralLatency,
                    nThreads: speechConfig?.voxtralThreads,
                    maxModelLen: speechConfig?.voxtralMaxLen
                });
                logger.log('info', `Voxtral model loaded for the meeting: ${modelPath}`);
            } catch (e) {
                logger.log('warn', 'Failed to load the Voxtral model', e);
                if (!isCancelled) showToast('Voxtral could not be loaded: recording will use audio only', 'error');
            } finally {
                if (!isCancelled) setIsVoskLoading(false);
            }
        })();
        return () => { isCancelled = true; };
    }, [modelsReady, settings.transcriptionMode, speechConfig?.voxtralModel, speechConfig?.voxtralLatency, speechConfig?.voxtralThreads, speechConfig?.voxtralMaxLen, showToast]);

    // Recording never waits for models: without them it records audio only.
    return {
        activeVoskModel,
        isVoskLoading
    };
}
