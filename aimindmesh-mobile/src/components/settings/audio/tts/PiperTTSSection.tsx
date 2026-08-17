import React, { useState } from 'react';
import { SpeechConfig } from '../../../../types';
import { triggerHaptic } from '../../../../services/native';
import { PIPER_VOICES, downloadPiperVoice, deletePiperVoice } from '../../../../services/tts/piperVoiceDownloader';
import { fileImportService } from '../../../../services/file/fileImportService';
import { logger } from '../../../../services/logger';
import { getCleanModelName } from '../../../../utils/stringUtils';

interface PiperTTSSectionProps {
    speechConfig: SpeechConfig;
    onSpeechConfigChange: (config: SpeechConfig) => void;
    onShowLink: (title: string, urls: { label: string; url: string }[]) => void;
    downloadedPiperVoices: string[];
    onRefreshVoices: () => Promise<void>;
    externalPiperVoices: string[];
    onExternalPiperVoicesChange: (voices: string[] | ((prev: string[]) => string[])) => void;
}

export const PiperTTSSection: React.FC<PiperTTSSectionProps> = ({
    speechConfig,
    onSpeechConfigChange,
    onShowLink,
    downloadedPiperVoices,
    onRefreshVoices,
    externalPiperVoices,
    onExternalPiperVoicesChange
}) => {
    const [downloadProgress, setDownloadProgress] = useState<Record<string, { bytesDownloaded: number, totalBytes: number, percentage: number }>>({});
    const [isImportingPiper, setIsImportingPiper] = useState(false);

    const handleDownloadPiperVoice = async (voice: typeof PIPER_VOICES[0]) => {
        triggerHaptic();
        try {
            setDownloadProgress(prev => ({
                ...prev,
                [voice.id]: {
                    bytesDownloaded: 0,
                    totalBytes: voice.size,
                    percentage: 0
                }
            }));

            await downloadPiperVoice(voice, (progress) => {
                setDownloadProgress(prev => ({
                    ...prev,
                    [voice.id]: progress
                }));
            });

            await onRefreshVoices();

            setTimeout(() => {
                setDownloadProgress(prev => {
                    const newState = { ...prev };
                    delete newState[voice.id];
                    return newState;
                });
            }, 2000);

        } catch (e) {
            logger.log('error', 'Piper download failed', e);
            alert('Download failed: ' + (e as any).message);
            setDownloadProgress(prev => {
                const newState = { ...prev };
                delete newState[voice.id];
                return newState;
            });
        }
    };

    const handleDeletePiperVoice = async (voiceId: string) => {
        if (externalPiperVoices.includes(voiceId)) {
            if (window.confirm('Remove this voice from list? (Files will not be deleted)')) {
                triggerHaptic();
                onExternalPiperVoicesChange(prev => prev.filter(v => v !== voiceId));
            }
            return;
        }

        if (window.confirm('Delete this Piper voice?')) {
            triggerHaptic();
            try {
                await deletePiperVoice(voiceId);
                await onRefreshVoices();
            } catch (e) {
                logger.log('error', 'Failed to delete Piper voice', e);
            }
        }
    };

    const handleImportPiperVoice = async () => {
        triggerHaptic();
        try {
            const pickedOnnx = await fileImportService.pickFile({
                extensions: ['onnx'],
                destinationDirectory: 'piper-voices'
            });

            if (!pickedOnnx || !pickedOnnx.success) return;

            const pickedJson = await fileImportService.pickFile({
                extensions: ['json'],
                destinationDirectory: 'piper-voices'
            });

            if (!pickedJson || !pickedJson.success) {
                alert('Please also select the corresponding .json config file');
                return;
            }

            setIsImportingPiper(true);
            try {
                const { importPiperVoice } = await import('../../../../services/tts/piperVoiceDownloader');
                const voiceId = pickedOnnx.cleanName.replace('.onnx', '');

                const importedPath = await importPiperVoice(pickedOnnx.path, pickedJson.path, voiceId);

                const { isDesktop } = await import('../../../../utils/platform');
                if (isDesktop()) {
                    if (!externalPiperVoices.includes(importedPath)) {
                        onExternalPiperVoicesChange(prev => [...prev, importedPath]);
                    }
                }

                await onRefreshVoices();
                alert(`Successfully imported: ${voiceId}`);
            } finally {
                setIsImportingPiper(false);
            }
        } catch (e) {
            setIsImportingPiper(false);
            logger.log('error', 'Failed to import Piper voice', e);
            alert('Failed to import voice: ' + (e as any).message);
        }
    };

    return (
        <div className="space-y-4 bg-surface/30 p-4 rounded-lg border border-white/5">
            <h4 className="text-sm font-semibold textPrimary mb-2">Piper Voices</h4>
            <div className="grid grid-cols-1 gap-3">
                {PIPER_VOICES.map(voice => (
                    <div key={voice.id} className="bg-surface/50 p-3 rounded-lg border border-white/5 flex items-center justify-between">
                        <div className="flex-1 min-w-0 mr-3">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="font-medium text-sm textPrimary truncate">{voice.name}</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface border border-white/10 textSecondary">
                                    {voice.language}
                                </span>
                            </div>
                            <p className="text-xs textSecondary truncate">{voice.description}</p>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="text-[10px] textSecondary">
                                    Quality: {voice.quality}
                                </span>
                                {downloadProgress[voice.id] && (
                                    <div className="flex-1 h-1 bg-surface rounded-full overflow-hidden max-w-[100px]">
                                        <div
                                            className="h-full bg-primary transition-all duration-300"
                                            style={{ width: `${downloadProgress[voice.id].percentage}%` }}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex flex-col gap-2 items-end">
                            {downloadedPiperVoices.includes(voice.id) ? (
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-green-400 font-medium px-2 py-1 bg-green-500/10 rounded">Downloaded</span>
                                    <div className="flex items-center gap-1">
                                        <input
                                            type="radio"
                                            name="piperVoiceId"
                                            checked={speechConfig.piperVoiceId === voice.id}
                                            onChange={() => onSpeechConfigChange({ ...speechConfig, piperVoiceId: voice.id })}
                                            className="h-4 w-4 text-green-500 bg-input border-surface focus:ring-green-500"
                                        />
                                        <button
                                            onClick={() => onShowLink(voice.name, [
                                                { label: 'ONNX Model', url: voice.url },
                                                { label: 'JSON Config', url: voice.url + '.json' }
                                            ])}
                                            className="p-2 text-blue-400 hover:bg-blue-500/10 rounded-full transition-colors"
                                            title="Show Link"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                            </svg>
                                        </button>
                                        <button
                                            onClick={() => handleDeletePiperVoice(voice.id)}
                                            className="p-1.5 text-red-400 hover:bg-red-500/10 rounded-full transition-colors"
                                            title="Delete Voice"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <button
                                    onClick={() => handleDownloadPiperVoice(voice)}
                                    disabled={!!downloadProgress[voice.id]}
                                    className="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 rounded-md text-xs font-medium transition-colors flex items-center gap-1 disabled:opacity-50"
                                >
                                    {downloadProgress[voice.id] ? (
                                        <span>{Math.round(downloadProgress[voice.id].percentage)}%</span>
                                    ) : (
                                        <>
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                            </svg>
                                            <span>Download</span>
                                        </>
                                    )}
                                </button>
                            )}
                        </div>
                    </div>
                ))}

                {/* Custom/Imported Piper Models Section */}
                {downloadedPiperVoices.filter(id => !PIPER_VOICES.some(v => v.id === id)).map(voiceId => (
                    <div key={voiceId} className="bg-surface/50 p-3 rounded-lg border border-purple-500/30 flex items-center justify-between">
                        <div className="flex-1 min-w-0 mr-3">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="font-medium text-sm textPrimary truncate" title={voiceId}>
                                    {getCleanModelName(voiceId)}
                                </span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                                    Custom
                                </span>
                            </div>
                            <p className="text-xs textSecondary truncate">Imported Voice Model</p>
                        </div>

                        <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1">
                                <input
                                    type="radio"
                                    name="piperVoiceId"
                                    checked={speechConfig.piperVoiceId === voiceId}
                                    onChange={() => onSpeechConfigChange({ ...speechConfig, piperVoiceId: voiceId })}
                                    className="h-4 w-4 text-green-500 bg-input border-surface focus:ring-green-500"
                                />
                                <button
                                    onClick={() => handleDeletePiperVoice(voiceId)}
                                    className="p-1.5 text-red-400 hover:bg-red-500/10 rounded-full transition-colors"
                                    title="Delete Voice"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="mt-4 pt-4 border-t border-white/5">
                <button
                    onClick={handleImportPiperVoice}
                    disabled={isImportingPiper}
                    className="w-full py-2 px-4 bg-surface hover:bg-surface/80 border border-white/10 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                >
                    {isImportingPiper ? (
                        <span className="animate-pulse">Importing...</span>
                    ) : (
                        <>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                            </svg>
                            Import Custom Piper Voice
                        </>
                    )}
                </button>
                <p className="text-xs textSecondary mt-2 text-center">
                    Select both .onnx and .json config files
                </p>
            </div>
        </div>
    );
};
