import React, { useState, useEffect } from 'react';
import { SpeechConfig } from '../../../../types';
import { triggerHaptic } from '../../../../services/native';
import { fileImportService } from '../../../../services/file/fileImportService';
import { logger } from '../../../../services/logger';
import { checkKokoroStatus as checkKokoroStatusService, downloadKokoroModel, importKokoroModel } from '../../../../services/tts/kokoroModelDownloader';
import { Kokoro } from '../../../../services/tts/kokoroPlugin';

interface KokoroTTSSectionProps {
    speechConfig: SpeechConfig;
    onSpeechConfigChange: (config: SpeechConfig) => void;
    isKokoroReady: boolean;
    onStatusChange: () => void;
}

const KOKORO_VOICES = [
    { id: 'if_sara', name: 'Sara', desc: 'Italian (Female)', color: 'text-purple-500', focusRing: 'focus:ring-purple-500' },
    { id: 'im_nicola', name: 'Nicola', desc: 'Italian (Male)', color: 'text-purple-500', focusRing: 'focus:ring-purple-500' },
    { id: 'divider', isDivider: true },
    { id: 'af_sky', name: 'Sky', desc: 'English US (Female)', color: 'text-blue-500', focusRing: 'focus:ring-blue-500' },
    { id: 'am_michael', name: 'Michael', desc: 'English US (Male)', color: 'text-blue-500', focusRing: 'focus:ring-blue-500' },
    { id: 'bf_emma', name: 'Emma', desc: 'English UK (Female)', color: 'text-blue-500', focusRing: 'focus:ring-blue-500' },
    { id: 'bm_george', name: 'George', desc: 'English UK (Male)', color: 'text-blue-500', focusRing: 'focus:ring-blue-500' }
];

export const KokoroTTSSection: React.FC<KokoroTTSSectionProps> = ({
    speechConfig,
    onSpeechConfigChange,
    isKokoroReady,
    onStatusChange
}) => {
    const [isImportingKokoro, setIsImportingKokoro] = useState(false);
    const [kokoroDownloadProgress, setKokoroDownloadProgress] = useState<{ progress: number, message: string } | null>(null);

    useEffect(() => {
        const pListener = Kokoro.addListener('onDownloadProgress', (data) => {
            setKokoroDownloadProgress(data);
        });
        const cListener = Kokoro.addListener('onDownloadComplete', () => {
            setKokoroDownloadProgress(null);
            onStatusChange();
        });
        const eListener = Kokoro.addListener('onDownloadError', (data) => {
            setKokoroDownloadProgress(null);
            alert('Error downloading/extracting Kokoro: ' + data.error);
        });

        return () => {
            pListener.then(l => l.remove());
            cListener.then(l => l.remove());
            eListener.then(l => l.remove());
        };
    }, [onStatusChange]);

    const handleDownloadKokoro = async () => {
        triggerHaptic();
        try {
            setKokoroDownloadProgress({ progress: 0, message: 'Initializing...' });
            await downloadKokoroModel();
        } catch (e) {
            logger.log('error', `Failed to start Kokoro download`, e);
        }
    };

    const handleImportKokoro = async () => {
        triggerHaptic();
        try {
            const pickedFile = await fileImportService.pickFile({
                extensions: ['bz2', 'tbz2', 'tar.bz2', 'tar.gz', 'tgz', 'zip', 'tar'],
                destinationDirectory: 'kokoro-bundle'
            });

            if (!pickedFile || !pickedFile.success) return;

            setIsImportingKokoro(true);
            setKokoroDownloadProgress({ progress: 0, message: 'Extracting files...' });
            try {
                await importKokoroModel(pickedFile.path);
                const ready = await checkKokoroStatusService();
                if (ready) {
                    onStatusChange();
                    alert('Kokoro model imported successfully!');
                }
            } finally {
                setIsImportingKokoro(false);
                setKokoroDownloadProgress(null);
            }
        } catch (e) {
            setIsImportingKokoro(false);
            setKokoroDownloadProgress(null);
            logger.log('error', 'Failed to import Kokoro voice', e);
            alert('Failed to import Kokoro bundle: ' + (e as any).message);
        }
    };

    return (
        <div className="space-y-4 bg-surface/30 p-4 rounded-lg border border-white/5">
            <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold textPrimary">Kokoro Setup</h4>
                {isKokoroReady ? (
                    <span className="text-xs text-green-400 font-medium px-2 py-1 bg-green-500/10 rounded border border-green-500/20">Ready to use</span>
                ) : (
                    <span className="text-xs text-orange-400 font-medium px-2 py-1 bg-orange-500/10 rounded border border-orange-500/20">Missing files</span>
                )}
            </div>

            <p className="text-xs textSecondary mb-3">
                Kokoro is a high-quality offline TTS engine powered by Sherpa-ONNX. It requires a one-time ~350MB download which includes voices and language data.
            </p>

            {!isKokoroReady && (
                <div className="grid grid-cols-1 gap-2">
                    <button
                        onClick={handleDownloadKokoro}
                        disabled={kokoroDownloadProgress !== null || isImportingKokoro}
                        className="w-full py-2 px-4 bg-surface hover:bg-surface/80 border border-white/10 rounded-lg text-sm font-medium flex items-center justify-center transition-colors relative overflow-hidden"
                    >
                        {kokoroDownloadProgress ? (
                            <>
                                <div
                                    className="absolute left-0 top-0 bottom-0 bg-primary/20 transition-all duration-300"
                                    style={{ width: `${kokoroDownloadProgress.progress}%` }}
                                />
                                <span className="relative z-10">{kokoroDownloadProgress.message}</span>
                            </>
                        ) : (
                            <span>Download Kokoro Bundle (~350 MB)</span>
                        )}
                    </button>
                    <button
                        onClick={handleImportKokoro}
                        disabled={kokoroDownloadProgress !== null || isImportingKokoro}
                        className="w-full py-2 px-4 bg-surface hover:bg-surface/80 border border-white/10 rounded-lg text-sm font-medium flex items-center justify-center transition-colors mt-2"
                    >
                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                        </svg>
                        {isImportingKokoro ? (
                            <span className="animate-pulse">
                                {kokoroDownloadProgress ? kokoroDownloadProgress.message : 'Importing...'}
                            </span>
                        ) : (
                            'Import bundle from File (.tar.bz2 / .zip)'
                        )}
                    </button>
                </div>
            )}

            {isKokoroReady && (
                <div className="mt-4 pt-4 border-t border-white/5">
                    <h4 className="text-sm font-semibold textPrimary mb-3">Select Voice</h4>

                    {KOKORO_VOICES.map((voice, idx) => {
                        if (voice.isDivider) {
                            return <div key={`div-${idx}`} className="h-px bg-white/10 w-full my-3" />;
                        }

                        return (
                            <label
                                key={voice.id}
                                className="flex items-center gap-3 p-3 rounded-lg border border-white/5 bg-surface/30 hover:bg-surface/50 cursor-pointer mb-2 transition-colors"
                            >
                                <input
                                    type="radio"
                                    name="kokoroVoiceId"
                                    value={voice.id}
                                    checked={speechConfig.kokoroVoiceId === voice.id}
                                    onChange={() => onSpeechConfigChange({ ...speechConfig, kokoroVoiceId: voice.id })}
                                    className={`h-4 w-4 ${voice.color} bg-input border-surface ${voice.focusRing}`}
                                />
                                <div>
                                    <span className="font-medium text-sm textPrimary">{voice.name}</span>
                                    <p className="text-xs textSecondary">{voice.desc}</p>
                                </div>
                            </label>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

