import React, { useEffect, useRef } from 'react';
import { getDownloadStatus, trackDownload, ModelDownloadProgress } from '../services/model/modelDownloader';

export interface ResumableDownload {
    id: string;
    url: string;
    filename: string;
}

/**
 * Downloads keep running natively when a model screen is closed, but the screen loses its
 * progress state. On mount this picks up the ones still running: their progress is shown
 * again and onFinished is called when they end.
 */
export function useDownloadResume(
    items: ResumableDownload[],
    setProgress: React.Dispatch<React.SetStateAction<Record<string, ModelDownloadProgress>>>,
    onFinished: (id: string, ok: boolean) => void
): void {
    const onFinishedRef = useRef(onFinished);
    onFinishedRef.current = onFinished;

    useEffect(() => {
        let active = true;
        const clear = (id: string) => setProgress(prev => {
            const next = { ...prev };
            delete next[id];
            return next;
        });

        (async () => {
            for (const item of items) {
                const status = await getDownloadStatus(item.url);
                if (!active || !status || status.completed || status.failed || status.cancelled) continue;

                setProgress(prev => (prev[item.id] ? prev : { ...prev, [item.id]: status }));
                trackDownload(item.url, item.filename, progress => {
                    if (active) setProgress(prev => ({ ...prev, [item.id]: progress }));
                })
                    .then(() => { if (active) onFinishedRef.current(item.id, true); })
                    .catch(() => { if (active) onFinishedRef.current(item.id, false); })
                    .finally(() => { if (active) clear(item.id); });
            }
        })();

        return () => { active = false; };
        // The lists are static catalogs (recommended models): checked once per mount
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
}
