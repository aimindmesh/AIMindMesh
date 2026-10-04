import { useCallback, useEffect, useState } from 'react';
import { Genie, GenieCapabilities, GenieLoadedModel, GenieModelInfo } from 'genie-capacitor';
import { RECOMMENDED_GENIE_MODELS, cancelDownload, deleteLocalModel, downloadModel, ModelDownloadProgress } from '../services/model/modelDownloader';
import { getLastGenieProfile, onGenieProfile, GenieProfileRecord } from '../services/llm/npuStats';
import { useDownloadResume } from './useDownloadResume';
import { logger } from '../services/logger';

export type GenieRecommendedModel = typeof RECOMMENDED_GENIE_MODELS[number];
export type GenieLoadedStatus = { loaded: boolean; modelPath?: string } & GenieLoadedModel;

/** Downloaded file of a recommended model: the GGUF downloader saves `<id>.gguf` in the app's files dir */
export const recommendedFileName = (model: GenieRecommendedModel) => `${model.id}.gguf`;

/**
 * State of the Genie settings: what the phone supports, the loaded model, downloads of the
 * recommended GGUFs and the last measured speed. The models on disk (QAIRT bundles and GGUF files)
 * go to `setModels`, the list the QAIRT import also updates.
 */
export function useGenieModels(setModels: (models: GenieModelInfo[]) => void, hfToken: string) {
    const [capabilities, setCapabilities] = useState<GenieCapabilities | null>(null);
    const [status, setStatus] = useState<GenieLoadedStatus>({ loaded: false });
    const [progress, setProgress] = useState<Record<string, ModelDownloadProgress>>({});
    const [profile, setProfile] = useState<GenieProfileRecord | null>(getLastGenieProfile());

    const refresh = useCallback(async () => {
        try {
            const [caps, loaded, list] = await Promise.all([Genie.getCapabilities(), Genie.isLoaded(), Genie.listLocalModels()]);
            setCapabilities(caps);
            setStatus(loaded);
            setModels(list.models || []);
        } catch {
            // Not available on this platform
        }
    }, [setModels]);

    useEffect(() => { void refresh(); }, [refresh]);
    useEffect(() => onGenieProfile(setProfile), []);

    useDownloadResume(
        RECOMMENDED_GENIE_MODELS.map(m => ({ id: m.id, url: m.url, filename: recommendedFileName(m) })),
        setProgress,
        () => { void refresh(); }
    );

    const clearProgress = (id: string) => setProgress(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
    });

    const download = async (model: GenieRecommendedModel) => {
        setProgress(prev => ({ ...prev, [model.id]: { bytesDownloaded: 0, totalBytes: model.size, percentage: 0, completed: false, failed: false } }));
        try {
            await downloadModel(model.url, recommendedFileName(model), p => setProgress(prev => ({ ...prev, [model.id]: p })), hfToken);
            await refresh();
        } catch (e: any) {
            logger.log('error', `[GenieModels] Download of ${model.id} failed`, e);
            alert('Download failed: ' + e.message);
        } finally {
            clearProgress(model.id);
        }
    };

    const cancel = async (model: GenieRecommendedModel) => {
        await cancelDownload(model.url);
        clearProgress(model.id);
    };

    /** Deletes a GGUF file (QAIRT bundles stay: they are managed by import) */
    const remove = async (model: GenieModelInfo) => {
        const fileName = model.path.split('/').pop();
        if (!fileName || model.runtime !== 'llama_cpp') return;
        if (status.loaded && status.modelPath === model.path) await Genie.unloadModel();
        await deleteLocalModel(fileName);
        await refresh();
    };

    return { capabilities, status, progress, profile, refresh, download, cancel, remove };
}
