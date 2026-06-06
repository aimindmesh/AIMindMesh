import { useState, useEffect } from 'react';
import { RECOMMENDED_MODELS, downloadModel, deleteLocalModel, cancelDownload, ModelDownloadProgress } from '../services/model/modelDownloader';
import { fileImportService } from '../services/file/fileImportService';
import { logger } from '../services/logger';
import { LLMConfig } from '../types';

export const useNativeModels = (
    llmConfig: LLMConfig,
    onLlmConfigSave: (config: LLMConfig) => void,
    hfToken: string,
    triggerHaptic: () => void
) => {
    const [downloadProgress, setDownloadProgress] = useState<Record<string, ModelDownloadProgress>>({});
    const [downloadedModels, setDownloadedModels] = useState<string[]>([]);
    const [importedModels, setImportedModels] = useState<string[]>([]);
    const [externalModels, setExternalModels] = useState<string[]>(() => {
        try {
            const saved = localStorage.getItem('external_gguf_models');
            return saved ? JSON.parse(saved) : [];
        } catch (e) {
            return [];
        }
    });

    const [externalLiteRTModels, setExternalLiteRTModels] = useState<string[]>(() => {
        try {
            const saved = localStorage.getItem('external_litert_models');
            return saved ? JSON.parse(saved) : [];
        } catch (e) {
            return [];
        }
    });

    const [downloadedLiteRTModels, setDownloadedLiteRTModels] = useState<string[]>([]);
    const [isImporting, setIsImporting] = useState(false);

    // Save external models when changed
    useEffect(() => {
        localStorage.setItem('external_gguf_models', JSON.stringify(externalModels));
    }, [externalModels]);

    useEffect(() => {
        localStorage.setItem('external_litert_models', JSON.stringify(externalLiteRTModels));
    }, [externalLiteRTModels]);

    // Initial check for downloaded models
    useEffect(() => {
        const checkModels = async () => {
            const { modelExists, getLocalGgufModels, getLocalLiteRTModels } = await import('../services/model/modelDownloader');
            const downloaded: string[] = [];

            for (const model of RECOMMENDED_MODELS) {
                const exists = await modelExists(model.id + '.gguf');
                if (exists) downloaded.push(model.id);
            }
            setDownloadedModels(downloaded);

            // Check LiteRT models
            const litertFiles = await getLocalLiteRTModels();
            setDownloadedLiteRTModels([...litertFiles, ...externalLiteRTModels]);

            const allGgufFiles = await getLocalGgufModels();
            const recommendedFilenames = RECOMMENDED_MODELS.map(m => m.id + '.gguf');
            const imported = allGgufFiles.filter(filename => !recommendedFilenames.includes(filename));
            setImportedModels(imported);
        };

        checkModels();
    }, [externalLiteRTModels]);

    const handleDownloadModel = async (model: typeof RECOMMENDED_MODELS[0]) => {
        triggerHaptic();
        const filename = model.id + '.gguf';

        try {
            setDownloadProgress(prev => ({
                ...prev,
                [model.id]: {
                    bytesDownloaded: 0,
                    totalBytes: model.size,
                    percentage: 0,
                    completed: false,
                    failed: false
                }
            }));

            await downloadModel(model.url, filename, (progress) => {
                setDownloadProgress(prev => ({
                    ...prev,
                    [model.id]: progress
                }));
            }, hfToken);

            const { modelExists } = await import('../services/model/modelDownloader');
            if (await modelExists(filename)) {
                setDownloadedModels(prev => [...prev, model.id]);
            }

            setTimeout(() => {
                setDownloadProgress(prev => {
                    const newState = { ...prev };
                    delete newState[model.id];
                    return newState;
                });
            }, 2000);

        } catch (e) {
            logger.log('error', 'Download failed', e);
            alert('Download failed: ' + (e as any).message);
        }
    };

    const handleCancelDownload = async (model: typeof RECOMMENDED_MODELS[0]) => {
        triggerHaptic();
        await cancelDownload(model.url);
        setDownloadProgress(prev => {
            const newState = { ...prev };
            delete newState[model.id];
            return newState;
        });
    };

    const handleDeleteModel = async (modelId: string) => {
        if (confirm('Are you sure you want to delete this model?')) {
            triggerHaptic();
            const filename = modelId + '.gguf';
            await deleteLocalModel(filename);
            setDownloadedModels(prev => prev.filter(id => id !== modelId));

            if (llmConfig.nativeModelPath?.includes(filename)) {
                onLlmConfigSave({ ...llmConfig, nativeModelPath: undefined });
            }
        }
    };

    const handleDeleteExternalModel = (path: string) => {
        if (confirm('Remove this model from the reference list? (File will NOT be deleted)')) {
            triggerHaptic();
            setExternalModels(prev => prev.filter(p => p !== path));
            if (llmConfig.nativeModelPath === path) {
                onLlmConfigSave({ ...llmConfig, nativeModelPath: undefined });
            }
        }
    };

    const handleDeleteLiteRTModel = async (filename: string) => {
        if (confirm('Are you sure you want to delete this model?')) {
            triggerHaptic();
            try {
                const { deleteModel } = await import('../services/model/modelDownloader');
                await deleteModel(filename);
                setDownloadedLiteRTModels(prev => prev.filter(f => f !== filename));

                if (llmConfig.liteRTModelPath === filename) {
                    onLlmConfigSave({
                        ...llmConfig,
                        liteRTModelId: undefined,
                        liteRTModelPath: undefined
                    });
                }
            } catch (e) {
                logger.log('error', 'Failed to delete LiteRT model', e);
                alert('Failed to delete model: ' + (e as any).message);
            }
        }
    };

    const handleDeleteExternalLiteRTModel = (path: string) => {
        if (confirm('Remove this model from the reference list? (File will NOT be deleted)')) {
            triggerHaptic();
            setExternalLiteRTModels(prev => prev.filter(p => p !== path));
            if (llmConfig.liteRTModelPath === path) {
                onLlmConfigSave({
                    ...llmConfig,
                    liteRTModelId: undefined,
                    liteRTModelPath: undefined
                });
            }
        }
    };

    const handleImportGgufFile = async (handleLoadNativeModel: (path: string, slot?: any) => Promise<void>) => {
        triggerHaptic();
        try {
            const picked = await fileImportService.pickFile({
                types: ['application/octet-stream'],
                extensions: ['gguf'],
                destinationDirectory: 'models'
            });

            if (picked && picked.success) {
                setIsImporting(true);
                try {
                    const { isDesktop } = await import('../utils/platform');

                    if (isDesktop()) {
                        if (!externalModels.includes(picked.path)) {
                            setExternalModels(prev => [...prev, picked.path]);
                        }
                        if (confirm(`Model selected: ${picked.cleanName}\nLoad this model now?`)) {
                            handleLoadNativeModel(picked.path, 'chat');
                        }
                    } else {
                        const { importGgufFile, getLocalGgufModels } = await import('../services/model/modelDownloader');
                        await importGgufFile(picked.path, picked.cleanName);

                        const allGgufFiles = await getLocalGgufModels();
                        const recommendedFilenames = RECOMMENDED_MODELS.map(m => m.id + '.gguf');
                        const imported = allGgufFiles.filter(filename => !recommendedFilenames.includes(filename));
                        setImportedModels(imported);
                        alert(`Successfully imported: ${picked.cleanName}`);
                    }
                } finally {
                    setIsImporting(false);
                }
            }
        } catch (e) {
            setIsImporting(false);
            logger.log('error', 'Failed to import GGUF file', e);
            alert('Failed to import file: ' + (e as any).message);
        }
    };

    const handleImportLiteRTFile = async () => {
        triggerHaptic();
        try {
            const picked = await fileImportService.pickFile({
                types: ['application/octet-stream'],
                extensions: ['litertlm', 'task'],
                destinationDirectory: 'models'
            });

            if (picked && picked.success) {
                setIsImporting(true);
                try {
                    const { importLiteRTFile, getLocalLiteRTModels } = await import('../services/model/modelDownloader');
                    const importedPath = await importLiteRTFile(picked.path, picked.cleanName);

                    const { isDesktop } = await import('../utils/platform');
                    if (isDesktop()) {
                        if (!externalLiteRTModels.includes(importedPath)) {
                            setExternalLiteRTModels(prev => [...prev, importedPath]);
                        }
                    }

                    if (isDesktop()) {
                        setDownloadedLiteRTModels(prev => [...prev, importedPath]);
                    } else {
                        const litertFiles = await getLocalLiteRTModels();
                        setDownloadedLiteRTModels(litertFiles);
                    }

                    onLlmConfigSave({
                        ...llmConfig,
                        liteRTModelId: 'imported',
                        liteRTModelPath: importedPath
                    });
                    alert(`Successfully imported: ${picked.cleanName}`);
                } finally {
                    setIsImporting(false);
                }
            }
        } catch (e) {
            setIsImporting(false);
            logger.log('error', 'Failed to import LiteRT file', e);
            alert('Failed to import file: ' + (e as any).message);
        }
    };

    return {
        downloadProgress, setDownloadProgress,
        downloadedModels, setDownloadedModels,
        importedModels, setImportedModels,
        externalModels, setExternalModels,
        externalLiteRTModels, setExternalLiteRTModels,
        downloadedLiteRTModels, setDownloadedLiteRTModels,
        isImporting, setIsImporting,
        handleDownloadModel,
        handleCancelDownload,
        handleDeleteModel,
        handleDeleteExternalModel,
        handleDeleteLiteRTModel,
        handleDeleteExternalLiteRTModel,
        handleImportGgufFile,
        handleImportLiteRTFile
    };
};
