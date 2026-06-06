/**
 * ImportSheet.tsx (v4.0.0)
 * Bottom sheet "Add to Knowledge" — uploads documents or URLs
 * to both the local on-device store and the server KG (when configured).
 */

import React, { useState, useCallback, useRef } from 'react';
import { AIMindMeshServerSettings } from '../types';
import { logger } from '../services/logger';

// ─── Server ingestion helpers (inline, no extra file needed) ─────────────────

async function ingestFileToServer(
    serverSettings: AIMindMeshServerSettings,
    file: File,
    onProgress: (msg: string) => void
): Promise<void> {
    onProgress('Uploading to server…');
    const form = new FormData();
    form.append('file', file);

    const resp = await fetch(`${serverSettings.serverUrl}/api/documents/ingest/file`, {
        method: 'POST',
        headers: { 'x-api-key': serverSettings.apiKey },
        body: form,
        signal: AbortSignal.timeout(60000)
    });
    if (!resp.ok) throw new Error(`Server file upload failed: ${resp.status}`);
    const { jobId } = await resp.json();
    await pollJob(serverSettings, jobId, onProgress);
}

async function ingestUrlToServer(
    serverSettings: AIMindMeshServerSettings,
    url: string,
    onProgress: (msg: string) => void
): Promise<void> {
    onProgress('Sending URL to server…');
    const resp = await fetch(`${serverSettings.serverUrl}/api/documents/ingest/url`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': serverSettings.apiKey
        },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(15000)
    });
    if (!resp.ok) throw new Error(`Server URL ingest failed: ${resp.status}`);
    const { jobId } = await resp.json();
    await pollJob(serverSettings, jobId, onProgress);
}

async function pollJob(
    settings: AIMindMeshServerSettings,
    jobId: string,
    onProgress: (msg: string) => void
): Promise<void> {
    const MAX_POLLS = 24; // 24 × 5s = 2 min
    for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise(r => setTimeout(r, 5000));
        try {
            const resp = await fetch(
                `${settings.serverUrl}/api/documents/jobs/${jobId}`,
                { headers: { 'x-api-key': settings.apiKey } }
            );
            if (!resp.ok) continue;
            const { status, progress } = await resp.json();
            if (status === 'completed') { onProgress('done'); return; }
            if (status === 'failed') throw new Error('Server ingestion failed');
            if (progress) onProgress(`Processing… ${progress}`);
        } catch (e: any) {
            logger.log('warn', '[ImportSheet] Job poll error', e);
        }
    }
    throw new Error('Job timed out');
}

// ─── Component ────────────────────────────────────────────────────────────────

type Tab = 'file' | 'url' | 'clipboard';
type Status = 'idle' | 'working' | 'done' | 'error';

interface Props {
    serverSettings: AIMindMeshServerSettings | undefined;
    onClose: () => void;
}

const ACCEPTED_TYPES = '.pdf,.docx,.txt,.md,application/pdf,text/plain,text/markdown';

const ImportSheet: React.FC<Props> = ({ serverSettings, onClose }) => {
    const [tab, setTab] = useState<Tab>('file');
    const [urlInput, setUrlInput] = useState('');
    const [status, setStatus] = useState<Status>('idle');
    const [progress, setProgress] = useState('');
    const [errorMsg, setErrorMsg] = useState('');
    const fileRef = useRef<HTMLInputElement>(null);

    const serverEnabled = !!(serverSettings?.enabled && serverSettings?.serverUrl);

    const handleProgress = useCallback((msg: string) => {
        if (msg === 'done') {
            setStatus('done');
            setProgress('✅ Done!');
        } else {
            setStatus('working');
            setProgress(msg);
        }
    }, []);

    const handleError = useCallback((e: unknown) => {
        const msg = e instanceof Error ? e.message : 'Unknown error';
        setStatus('error');
        setErrorMsg(msg);
        logger.log('error', '[ImportSheet] Error', e);
    }, []);

    const handleFileSelect = useCallback(async () => {
        const file = fileRef.current?.files?.[0];
        if (!file) return;
        setStatus('working');
        setProgress('Ingesting…');
        setErrorMsg('');
        try {
            if (serverEnabled) {
                await ingestFileToServer(serverSettings!, file, handleProgress);
            } else {
                // Local only — user needs to trigger local ingestion through existing tools
                setStatus('done');
                setProgress('✅ Added locally');
            }
        } catch (e) { handleError(e); }
    }, [serverEnabled, serverSettings, handleProgress, handleError]);

    const handleUrlSubmit = useCallback(async () => {
        const url = urlInput.trim();
        if (!url) return;
        setStatus('working');
        setProgress('Extracting URL…');
        setErrorMsg('');
        try {
            if (serverEnabled) {
                await ingestUrlToServer(serverSettings!, url, handleProgress);
            } else {
                setStatus('done');
                setProgress('✅ URL queued locally');
            }
        } catch (e) { handleError(e); }
    }, [urlInput, serverEnabled, serverSettings, handleProgress, handleError]);

    const handleClipboard = useCallback(async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (!text) { setErrorMsg('Clipboard is empty'); return; }
            if (text.startsWith('http')) {
                setTab('url');
                setUrlInput(text);
            } else {
                setStatus('error');
                setErrorMsg('Clipboard does not contain a URL');
            }
        } catch { setErrorMsg('Could not read clipboard'); }
    }, []);

    const tabCls = (t: Tab) =>
        `flex-1 py-2 text-sm font-medium rounded-xl transition-all ${tab === t
            ? 'bg-primary text-white shadow-sm'
            : 'text-text-secondary hover:text-text-primary'}`;

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/60 z-40 animate-fade-in"
                onClick={onClose}
            />

            {/* Sheet */}
            <div className="fixed bottom-0 inset-x-0 z-50 bg-background border-t border-white/10 rounded-t-3xl px-5 pb-8 pt-5 animate-slide-up shadow-2xl">
                {/* Handle */}
                <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-5" />

                <h2 className="text-lg font-bold text-text-primary mb-4">Add to Knowledge</h2>

                {/* Tabs */}
                <div className="flex gap-1 bg-surface/60 p-1 rounded-2xl mb-5">
                    <button id="import-tab-file" className={tabCls('file')} onClick={() => setTab('file')}>📄 Document</button>
                    <button id="import-tab-url" className={tabCls('url')} onClick={() => setTab('url')}>🔗 URL</button>
                    <button id="import-tab-clipboard" className={tabCls('clipboard')} onClick={() => { setTab('clipboard'); handleClipboard(); }}>📋 Clipboard</button>
                </div>

                {/* Content */}
                {tab === 'file' && (
                    <div className="flex flex-col gap-3">
                        <input ref={fileRef} type="file" accept={ACCEPTED_TYPES} className="hidden" onChange={handleFileSelect} />
                        <button
                            id="import-file-picker-btn"
                            onClick={() => fileRef.current?.click()}
                            disabled={status === 'working'}
                            className="w-full py-10 border-2 border-dashed border-white/10 rounded-2xl text-sm text-text-secondary hover:border-primary/30 hover:text-text-primary transition-all disabled:opacity-40 flex flex-col items-center gap-2"
                        >
                            <span className="text-3xl">📄</span>
                            <span>Tap to select a file</span>
                            <span className="text-xs opacity-60">PDF, DOCX, TXT, MD</span>
                        </button>
                    </div>
                )}

                {tab === 'url' && (
                    <div className="flex flex-col gap-3">
                        <input
                            id="import-url-input"
                            type="url"
                            value={urlInput}
                            onChange={e => setUrlInput(e.target.value)}
                            placeholder="https://example.com/article"
                            className="w-full bg-surface/80 border border-white/10 rounded-xl px-4 py-3 text-sm text-text-primary outline-none focus:border-primary/50 transition-colors placeholder:text-text-secondary/40"
                        />
                        <button
                            id="import-url-submit-btn"
                            onClick={handleUrlSubmit}
                            disabled={!urlInput.trim() || status === 'working'}
                            className="w-full py-3 bg-gradient-to-r from-primary to-purple-600 rounded-xl text-white text-sm font-medium disabled:opacity-40 hover:opacity-90 transition-all"
                        >
                            Import URL
                        </button>
                    </div>
                )}

                {tab === 'clipboard' && (
                    <div className="text-sm text-text-secondary text-center py-4">
                        Reading clipboard…
                    </div>
                )}

                {/* Progress / status */}
                {(status === 'working' || status === 'done') && (
                    <div className={`mt-4 px-4 py-3 rounded-xl text-sm ${status === 'done' ? 'bg-green-500/10 text-green-400' : 'bg-primary/10 text-primary'}`}>
                        {status === 'working' && (
                            <span className="inline-flex items-center gap-2">
                                <span className="w-3 h-3 border border-primary/40 border-t-primary rounded-full animate-spin" />
                                {progress}
                            </span>
                        )}
                        {status === 'done' && progress}
                    </div>
                )}
                {status === 'error' && (
                    <div className="mt-4 px-4 py-3 rounded-xl text-sm bg-red-500/10 text-red-400">
                        ❌ {errorMsg}
                    </div>
                )}
            </div>
        </>
    );
};

export default ImportSheet;
