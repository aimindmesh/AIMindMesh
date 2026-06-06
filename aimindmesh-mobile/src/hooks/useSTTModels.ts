import { useState, useEffect } from 'react';
import { triggerHaptic } from '../services/native';
import { VOSK_MODELS, downloadVoskModel, deleteVoskModel, voskModelExists } from '../services/stt/voskModelDownloader';
import { WHISPER_MODELS, downloadWhisperModel, deleteWhisperModel, whisperModelExists } from '../services/stt/whisperModelDownloader';
import { VAD_MODELS, downloadVADModel, deleteVADModel, vadModelExists } from '../services/stt/vadModelDownloader';
import { logger } from '../services/logger';
import { fileImportService } from '../services/file/fileImportService';

export const useSTTModels = (
    externalModels: {
        vosk: string[];
        onVoskChange: (m: string[] | ((p: string[]) => string[])) => void;
        whisper: string[];
        onWhisperChange: (m: string[] | ((p: string[]) => string[])) => void;
        vad: string[];
        onVADChange: (m: string[] | ((p: string[]) => string[])) => void;
        voxtral: string[];
        onVoxtralChange: (m: string[] | ((p: string[]) => string[])) => void;
    }
) => {
    const [downloadProgress, setDownloadProgress] = useState<Record<string, { bytesDownloaded: number, totalBytes: number, percentage: number }>>({});
    const [downloadedVoskModels, setDownloadedVoskModels] = useState<string[]>([]);
    const [downloadedWhisperModels, setDownloadedWhisperModels] = useState<string[]>([]);
    const [downloadedVADModels, setDownloadedVADModels] = useState<string[]>([]);
    const [downloadedVoxtralModels, setDownloadedVoxtralModels] = useState<string[]>([]);
    const [downloadedVoxtralProjectors, setDownloadedVoxtralProjectors] = useState<string[]>([]);

    const [isImportingVosk, setIsImportingVosk] = useState(false);
    const [isImportingWhisper, setIsImportingWhisper] = useState(false);
    const [isImportingVAD, setIsImportingVAD] = useState(false);
    const [isImportingVoxtral, setIsImportingVoxtral] = useState(false);

    // External models persistence - MOVED TO PROPS
    const {
        vosk: externalVoskModels,
        onVoskChange: setExternalVoskModels,
        whisper: externalWhisperModels,
        onWhisperChange: setExternalWhisperModels,
        vad: externalVADModels,
        onVADChange: setExternalVADModels,
        voxtral: externalVoxtralModels,
        onVoxtralChange: setExternalVoxtralModels
    } = externalModels;

    // (removed local state and useEffects that wrote to localStorage)

    const checkDownloadedModels = async () => {
        // Check Vosk models
        const downloadedVosk: string[] = [...externalVoskModels];
        for (const model of VOSK_MODELS) {
            const exists = await voskModelExists(model.id);
            if (exists) downloadedVosk.push(model.id);
        }
        try {
            const { listLocalVoskModels } = await import('../services/stt/voskModelDownloader');
            const allVoskModels = await listLocalVoskModels();
            const predefinedVoskIds = VOSK_MODELS.map(m => m.id);
            for (const modelPath of allVoskModels) {
                if (!predefinedVoskIds.includes(modelPath) && !downloadedVosk.includes(modelPath)) {
                    downloadedVosk.push(modelPath);
                }
            }
        } catch (e) { logger.log('error', 'Failed to list local Vosk models', e); }
        setDownloadedVoskModels(downloadedVosk);

        // Check Whisper models
        const downloadedWhisper: string[] = [...externalWhisperModels];
        for (const model of WHISPER_MODELS) {
            const exists = await whisperModelExists(model.id);
            if (exists) downloadedWhisper.push(model.id);
        }
        try {
            const { listLocalWhisperModels } = await import('../services/stt/whisperModelDownloader');
            const allWhisperModels = await listLocalWhisperModels();
            const predefinedWhisperIds = WHISPER_MODELS.map(m => m.id);
            for (const modelPath of allWhisperModels) {
                if (!predefinedWhisperIds.includes(modelPath) && !downloadedWhisper.includes(modelPath)) {
                    downloadedWhisper.push(modelPath);
                }
            }
        } catch (e) { logger.log('error', 'Failed to list local Whisper models', e); }
        setDownloadedWhisperModels(downloadedWhisper);

        // Check VAD models
        const downloadedVAD: string[] = [...externalVADModels];
        for (const model of VAD_MODELS) {
            const exists = await vadModelExists(model.id);
            if (exists) downloadedVAD.push(model.id);
        }
        try {
            const { listLocalVADModels } = await import('../services/stt/vadModelDownloader');
            const allVADModels = await listLocalVADModels();
            const predefinedVADIds = VAD_MODELS.map(m => m.id);
            for (const modelPath of allVADModels) {
                if (!predefinedVADIds.includes(modelPath) && !downloadedVAD.includes(modelPath)) {
                    downloadedVAD.push(modelPath);
                }
            }
        } catch (e) { logger.log('error', 'Failed to list local VAD models', e); }
        setDownloadedVADModels(downloadedVAD);

        // Check Voxtral models and Projectors
        try {
            const { listLocalVoxtralModels, listLocalVoxtralProjectors } = await import('../services/stt/voxtralModelDownloader');
            const models = await listLocalVoxtralModels();
            const projectors = await listLocalVoxtralProjectors();
            const uniqueModels = [...new Set([...externalVoxtralModels, ...models])];
            setDownloadedVoxtralModels(uniqueModels);
            setDownloadedVoxtralProjectors(projectors);
        } catch (e) {
            logger.log('warn', 'Failed to list Voxtral models dynamically', e);
            setDownloadedVoxtralModels([...externalVoxtralModels]);
        }
    };

    useEffect(() => {
        checkDownloadedModels();
    }, [externalVoskModels, externalWhisperModels, externalVADModels, externalVoxtralModels]);

    const handleDownloadVoskModel = async (model: typeof VOSK_MODELS[0]) => {
        triggerHaptic();
        try {
            setDownloadProgress(prev => ({ ...prev, [model.id]: { bytesDownloaded: 0, totalBytes: model.size, percentage: 0 } }));
            await downloadVoskModel(model, (progress) => {
                setDownloadProgress(prev => ({ ...prev, [model.id]: progress }));
            });
            await checkDownloadedModels();
            setTimeout(() => {
                setDownloadProgress(prev => {
                    const newState = { ...prev };
                    delete newState[model.id];
                    return newState;
                });
            }, 2000);
        } catch (e) {
            logger.log('error', 'Vosk download failed', e);
            alert('Download failed: ' + (e as any).message);
            setDownloadProgress(prev => {
                const newState = { ...prev };
                delete newState[model.id];
                return newState;
            });
        }
    };

    const handleDeleteVoskModel = async (modelId: string) => {
        if (externalVoskModels.includes(modelId)) {
            if (window.confirm('Remove this model from list? (File will not be deleted)')) {
                triggerHaptic();
                setExternalVoskModels(prev => prev.filter(m => m !== modelId));
            }
            return;
        }
        if (window.confirm('Delete this Vosk model?')) {
            triggerHaptic();
            try {
                await deleteVoskModel(modelId);
                await checkDownloadedModels();
            } catch (e) { logger.log('error', 'Failed to delete Vosk model', e); }
        }
    };

    const handleImportVoskModel = async () => {
        triggerHaptic();
        try {
            const picked = await fileImportService.pickFile({
                types: ['application/zip'],
                extensions: ['zip'],
                destinationDirectory: 'vosk-models'
            });
            if (picked && picked.success) {
                setIsImportingVosk(true);
                try {
                    const { importVoskModel } = await import('../services/stt/voskModelDownloader');
                    const importedPath = await importVoskModel(picked.path, picked.cleanName);
                    const { isDesktop } = await import('../utils/platform');
                    if (isDesktop() && !externalVoskModels.includes(importedPath)) {
                        setExternalVoskModels(prev => [...prev, importedPath]);
                    }
                    await checkDownloadedModels();
                    alert(`Successfully imported: ${picked.cleanName}`);
                } finally { setIsImportingVosk(false); }
            }
        } catch (e) {
            setIsImportingVosk(false);
            logger.log('error', 'Failed to import Vosk model', e);
            alert('Failed to import model: ' + (e as any).message);
        }
    };

    const handleDownloadWhisperModel = async (model: typeof WHISPER_MODELS[0]) => {
        triggerHaptic();
        try {
            setDownloadProgress(prev => ({ ...prev, [model.id]: { bytesDownloaded: 0, totalBytes: model.sizeBytes, percentage: 0 } }));
            await downloadWhisperModel(model, (progress) => {
                setDownloadProgress(prev => ({ ...prev, [model.id]: progress }));
            });
            await checkDownloadedModels();
            setTimeout(() => {
                setDownloadProgress(prev => {
                    const newState = { ...prev };
                    delete newState[model.id];
                    return newState;
                });
            }, 2000);
        } catch (e) {
            logger.log('error', 'Whisper download failed', e);
            alert('Download failed: ' + (e as any).message);
            setDownloadProgress(prev => {
                const newState = { ...prev };
                delete newState[model.id];
                return newState;
            });
        }
    };

    const handleImportWhisperModel = async () => {
        triggerHaptic();
        try {
            const picked = await fileImportService.pickFile({
                extensions: ['bin'],
                destinationDirectory: 'whisper-models'
            });
            if (picked && picked.success) {
                setIsImportingWhisper(true);
                try {
                    const { importWhisperModel } = await import('../services/stt/whisperModelDownloader');
                    const importedPath = await importWhisperModel(picked.path, picked.cleanName);
                    const { isDesktop } = await import('../utils/platform');
                    if (isDesktop() && !externalWhisperModels.includes(importedPath)) {
                        setExternalWhisperModels(prev => [...prev, importedPath]);
                    }
                    await checkDownloadedModels();
                    alert(`Successfully imported: ${picked.cleanName}`);
                } finally { setIsImportingWhisper(false); }
            }
        } catch (e) {
            setIsImportingWhisper(false);
            logger.log('error', 'Failed to import Whisper model', e);
            alert('Failed to import model: ' + (e as any).message);
        }
    };

    const handleDeleteWhisperModel = async (modelId: string) => {
        if (externalWhisperModels.includes(modelId)) {
            if (window.confirm('Remove this model from list? (File will not be deleted)')) {
                triggerHaptic();
                setExternalWhisperModels(prev => prev.filter(m => m !== modelId));
            }
            return;
        }
        if (window.confirm('Delete this Whisper model?')) {
            triggerHaptic();
            try {
                await deleteWhisperModel(modelId);
                await checkDownloadedModels();
            } catch (e) { logger.log('error', 'Failed to delete Whisper model', e); }
        }
    };

    const handleDownloadVADModel = async (model: typeof VAD_MODELS[0]) => {
        triggerHaptic();
        try {
            setDownloadProgress(prev => ({ ...prev, [model.id]: { bytesDownloaded: 0, totalBytes: model.sizeBytes, percentage: 0 } }));
            await downloadVADModel(model, (progress) => {
                setDownloadProgress(prev => ({ ...prev, [model.id]: progress }));
            });
            await checkDownloadedModels();
            setTimeout(() => {
                setDownloadProgress(prev => {
                    const newState = { ...prev };
                    delete newState[model.id];
                    return newState;
                });
            }, 2000);
        } catch (e) {
            logger.log('error', 'VAD download failed', e);
            alert('Download failed: ' + (e as any).message);
            setDownloadProgress(prev => {
                const newState = { ...prev };
                delete newState[model.id];
                return newState;
            });
        }
    };

    const handleImportVADModel = async () => {
        triggerHaptic();
        try {
            const picked = await fileImportService.pickFile({
                extensions: ['onnx'],
                destinationDirectory: 'vad-models'
            });
            if (picked && picked.success) {
                setIsImportingVAD(true);
                try {
                    const { importVADModel } = await import('../services/stt/vadModelDownloader');
                    const importedPath = await importVADModel(picked.path, picked.cleanName);
                    const { isDesktop } = await import('../utils/platform');
                    if (isDesktop() && !externalVADModels.includes(importedPath)) {
                        setExternalVADModels(prev => [...prev, importedPath]);
                    }
                    await checkDownloadedModels();
                    alert(`Successfully imported: ${picked.cleanName}`);
                } finally { setIsImportingVAD(false); }
            }
        } catch (e) {
            setIsImportingVAD(false);
            logger.log('error', 'Failed to import VAD model', e);
            alert('Failed to import model: ' + (e as any).message);
        }
    };

    const handleDeleteVADModel = async (modelId: string) => {
        if (externalVADModels.includes(modelId)) {
            if (window.confirm('Remove this model from list? (File will not be deleted)')) {
                triggerHaptic();
                setExternalVADModels(prev => prev.filter(m => m !== modelId));
            }
            return;
        }
        if (window.confirm('Delete this VAD model?')) {
            triggerHaptic();
            try {
                await deleteVADModel(modelId);
                await checkDownloadedModels();
            } catch (e) { logger.log('error', 'Failed to delete VAD model', e); }
        }
    };

    const handleImportVoxtralModel = async () => {
        triggerHaptic();
        try {
            try {
                // The parent component handles the provider switch via its own state management
                // to avoid direct localStorage writes and state desync.
            } catch (e) { }

            await new Promise(r => setTimeout(r, 50));

            const picked = await fileImportService.pickFile({
                extensions: ['gguf'],
                destinationDirectory: 'voxtral-models'
            });

            if (picked && picked.success) {
                setIsImportingVoxtral(true);
                try {
                    const { importVoxtralModel } = await import('../services/stt/voxtralModelDownloader');
                    const importedPath = await importVoxtralModel(picked.path, picked.cleanName);
                    const { isDesktop } = await import('../utils/platform');
                    if (isDesktop() && !externalVoxtralModels.includes(importedPath)) {
                        setExternalVoxtralModels(prev => [...prev, importedPath]);
                    }
                    const { listLocalVoxtralModels } = await import('../services/stt/voxtralModelDownloader');
                    const models = await listLocalVoxtralModels();
                    const uniqueModels = [...new Set([...externalVoxtralModels, ...models])];
                    setExternalVoxtralModels(uniqueModels);
                    alert(`Successfully imported: ${picked.cleanName}`);
                } catch (err: any) {
                    logger.log('error', 'Voxtral copy failed', err);
                    alert(`Import failed: ${err.message}`);
                } finally { setIsImportingVoxtral(false); }
            }
        } catch (e) {
            setIsImportingVoxtral(false);
            logger.log('error', 'Failed to import Voxtral model', e);
            alert('Failed to import model: ' + (e as any).message);
        }
    };

    const handleDeleteVoxtralModel = async (modelId: string) => {
        if (externalVoxtralModels.includes(modelId)) {
            if (window.confirm('Remove this model from list? (File will not be deleted)')) {
                triggerHaptic();
                setExternalVoxtralModels(prev => prev.filter(m => m !== modelId));
            }
        }
    };

    return {
        downloadProgress,
        downloadedVoskModels,
        downloadedWhisperModels,
        downloadedVADModels,
        downloadedVoxtralModels,
        downloadedVoxtralProjectors,
        isImportingVosk,
        isImportingWhisper,
        isImportingVAD,
        isImportingVoxtral,
        handleDownloadVoskModel,
        handleDeleteVoskModel,
        handleImportVoskModel,
        handleDownloadWhisperModel,
        handleImportWhisperModel,
        handleDeleteWhisperModel,
        handleDownloadVADModel,
        handleImportVADModel,
        handleDeleteVADModel,
        handleImportVoxtralModel,
        handleDeleteVoxtralModel
    };
};
