import React, { useState, useEffect } from 'react';
import { SpeechConfig, LLMConfig } from '../../../types';
import { triggerHaptic } from '../../../services/native';
import { PIPER_VOICES, downloadPiperVoice, deletePiperVoice, piperVoiceExists } from '../../../services/tts/piperVoiceDownloader';
import { fileImportService } from '../../../services/file/fileImportService';
import { logger } from '../../../services/logger';
import { getCleanModelName } from '../../../utils/stringUtils';
import { GeminiTTSSection } from './tts/GeminiTTSSection';
import { checkKokoroStatus as checkKokoroStatusService, downloadKokoroModel, importKokoroModel } from '../../../services/tts/kokoroModelDownloader';
import { Kokoro } from '../../../services/tts/kokoroPlugin';

interface TTSSettingsProps {
    speechConfig: SpeechConfig;
    onSpeechConfigChange: (config: SpeechConfig) => void;
    onShowLink: (title: string, urls: { label: string; url: string }[]) => void;
    externalPiperVoices: string[];
    onExternalPiperVoicesChange: (voices: string[] | ((prev: string[]) => string[])) => void;
    llmConfig: LLMConfig;
    apiKey?: string;
}

const TTSSettings: React.FC<TTSSettingsProps> = ({
    speechConfig,
    onSpeechConfigChange,
    onShowLink,
    externalPiperVoices,
    onExternalPiperVoicesChange,
    llmConfig,
    apiKey
}) => {
    const [downloadProgress, setDownloadProgress] = useState<Record<string, { bytesDownloaded: number, totalBytes: number, percentage: number }>>({});
    const [downloadedPiperVoices, setDownloadedPiperVoices] = useState<string[]>([]);
    const [isImportingPiper, setIsImportingPiper] = useState(false);
    const [isKokoroReady, setIsKokoroReady] = useState(false);
    const [isImportingKokoro, setIsImportingKokoro] = useState(false);
    const [kokoroDownloadProgress, setKokoroDownloadProgress] = useState<{ progress: number, message: string } | null>(null);

    // External Piper voices persistence - MOVED TO PROPS
    // (removed local state and useEffect that wrote to localStorage)

    useEffect(() => {
        checkDownloadedModels();
        checkKokoroStatus();
    }, [externalPiperVoices]);

    useEffect(() => {
        const pListener = Kokoro.addListener('onDownloadProgress', (data) => {
            setKokoroDownloadProgress(data);
        });
        const cListener = Kokoro.addListener('onDownloadComplete', () => {
            setKokoroDownloadProgress(null);
            checkKokoroStatus();
        });
        const eListener = Kokoro.addListener('onDownloadError', (data) => {
            setKokoroDownloadProgress(null);
            alert('Errore download Kokoro: ' + data.error);
        });

        return () => {
            pListener.then(l => l.remove());
            cListener.then(l => l.remove());
            eListener.then(l => l.remove());
        };
    }, []);

    const checkKokoroStatus = async () => {
        const ready = await checkKokoroStatusCheck();
        setIsKokoroReady(ready);
        // Auto select Kokoro voice ID if missing but ready
        if (ready && speechConfig.ttsProvider === 'kokoro' && !speechConfig.kokoroVoiceId) {
            onSpeechConfigChange({ ...speechConfig, kokoroVoiceId: 'if_sara' });
        }
    };

    const checkKokoroStatusCheck = async (): Promise<boolean> => {
        return await checkKokoroStatusService();
    };


    const checkDownloadedModels = async () => {
        const downloadedPiper: string[] = [...externalPiperVoices]; // Start with external
        for (const voice of PIPER_VOICES) {
            const exists = await piperVoiceExists(voice.id);
            if (exists) downloadedPiper.push(voice.id);
        }

        try {
            const { listLocalPiperVoices } = await import('../../../services/tts/piperVoiceDownloader');
            const allPiperVoices = await listLocalPiperVoices();
            const predefinedPiperIds = PIPER_VOICES.map(v => v.id);

            for (const voiceId of allPiperVoices) {
                if (!predefinedPiperIds.includes(voiceId) && !downloadedPiper.includes(voiceId)) {
                    downloadedPiper.push(voiceId);
                }
            }
        } catch (e) {
            console.error('Failed to list local Piper voices', e);
        }

        setDownloadedPiperVoices(downloadedPiper);
    };

    const handleSpeechConfigChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        onSpeechConfigChange({ ...speechConfig, [name]: value });
    };


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

            await checkDownloadedModels();

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
                await checkDownloadedModels();
            } catch (e) {
                logger.log('error', 'Failed to delete Piper voice', e);
            }
        }
    };

    const handleImportPiperVoice = async () => {
        triggerHaptic();
        try {
            // Pick ONNX
            const pickedOnnx = await fileImportService.pickFile({
                extensions: ['onnx'],
                destinationDirectory: 'piper-voices' // Info only
            });

            if (!pickedOnnx || !pickedOnnx.success) return;

            // Pick JSON
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
                const { importPiperVoice } = await import('../../../services/tts/piperVoiceDownloader');
                // Use the clean name from the ONNX file as the voice ID
                const voiceId = pickedOnnx.cleanName.replace('.onnx', '');

                const importedPath = await importPiperVoice(pickedOnnx.path, pickedJson.path, voiceId);

                const { isDesktop } = await import('../../../utils/platform');
                // Use importedPath (which is source path on desktop) as ID if desktop
                if (isDesktop()) {
                    if (!externalPiperVoices.includes(importedPath)) {
                        onExternalPiperVoicesChange(prev => [...prev, importedPath]);
                    }
                }

                await checkDownloadedModels();
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

    const handleDownloadKokoro = async () => {
        triggerHaptic();
        try {
            setKokoroDownloadProgress({ progress: 0, message: 'Inizializzazione...' });
            await downloadKokoroModel();
        } catch (e) {
            logger.log('error', `Failed to start Kokoro download`, e);
        }
    };

    const handleImportKokoro = async () => {
        triggerHaptic();
        try {
            const pickedFile = await fileImportService.pickFile({
                extensions: ['bz2', 'tar.bz2'],
                destinationDirectory: 'kokoro-bundle'
            });

            if (!pickedFile || !pickedFile.success) return;

            setIsImportingKokoro(true);
            setKokoroDownloadProgress({ progress: 0, message: 'Estrazione file in corso...' });
            try {
                await importKokoroModel(pickedFile.path);
            } finally {
                setIsImportingKokoro(false);
            }
        } catch (e) {
            setIsImportingKokoro(false);
            setKokoroDownloadProgress(null);
            logger.log('error', 'Failed to import Kokoro voice', e);
            alert('Failed to import Kokoro bundle: ' + (e as any).message);
        }
    };

    return (
        <div className="space-y-6 animate-fade-in">
            {/* TTS Provider Selection */}
            <fieldset>
                <legend className="text-base font-medium textPrimary mb-3">Text-to-Speech (TTS) Provider</legend>

                <div className="grid grid-cols-1 gap-3">
                    {[
                        {
                            id: 'kokoro',
                            label: 'Kokoro (Offline, Best Quality)',
                            desc: 'State-of-the-art offline TTS. Requires 89MB model download.',
                            badge: 'New',
                            badgeColor: 'bg-purple-500/20 text-purple-400 border-purple-500/30'
                        },
                        {
                            id: 'piper',
                            label: 'Piper (Offline)',
                            desc: 'Fast, private, high quality. Requires voice download.',
                            badge: 'Private',
                            badgeColor: 'bg-green-500/20 text-green-400 border-green-500/30'
                        },
                        {
                            id: 'online',
                            label: 'Gemini (Online)',
                            desc: 'Very natural. Requires internet & API Key.',
                            badge: 'Online',
                            badgeColor: 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                        },
                        {
                            id: 'offline',
                            label: 'System Default',
                            desc: 'Uses Android system TTS engine.',
                            badge: 'System',
                            badgeColor: 'bg-gray-500/20 text-gray-400 border-gray-500/30'
                        }
                    ].map(option => (
                        <div
                            key={option.id}
                            className={`flex items-start p-3 rounded-lg border transition-all cursor-pointer ${speechConfig.ttsProvider === option.id
                                ? 'bg-primary/10 border-primary/40'
                                : 'bg-surface/30 border-white/5 hover:border-primary/20'
                                }`}
                            onClick={() => {
                                handleSpeechConfigChange({ target: { name: 'ttsProvider', value: option.id } } as any);
                                triggerHaptic();
                            }}
                        >
                            <input
                                id={`tts_${option.id}`}
                                name="ttsProvider"
                                type="radio"
                                value={option.id}
                                checked={speechConfig.ttsProvider === option.id}
                                onChange={handleSpeechConfigChange}
                                className="h-4 w-4 mt-0.5 text-primary bg-input border-surface focus:ring-primary flex-shrink-0"
                            />
                            <label htmlFor={`tts_${option.id}`} className="ml-3 flex-1 cursor-pointer">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="font-medium textPrimary">{option.label}</span>
                                    {option.badge && (
                                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${option.badgeColor}`}>
                                            {option.badge}
                                        </span>
                                    )}
                                </div>
                                <span className="text-xs textSecondary">{option.desc}</span>
                            </label>
                        </div>
                    ))}
                </div>
            </fieldset>

            {/* Default Audio Output Settings */}
            <fieldset className="bg-surface/30 rounded-lg p-4 border border-white/5">
                <legend className="text-sm font-medium textPrimary mb-3">📞 Call Audio Output</legend>
                <p className="text-xs textSecondary mb-3">
                    Choose the default audio output device for voice calls.
                </p>
                <div className="flex gap-6">
                    <label className="flex items-center gap-2 cursor-pointer group">
                        <div className="relative flex items-center">
                            <input
                                type="radio"
                                name="defaultAudioOutput"
                                value="earpiece"
                                checked={speechConfig.defaultAudioOutput !== 'speaker'}
                                onChange={handleSpeechConfigChange}
                                className="peer h-4 w-4 border-surface text-primary focus:ring-primary bg-input"
                            />
                        </div>
                        <span className="text-sm textPrimary group-hover:text-primary transition-colors">Earpiece</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer group">
                        <div className="relative flex items-center">
                            <input
                                type="radio"
                                name="defaultAudioOutput"
                                value="speaker"
                                checked={speechConfig.defaultAudioOutput === 'speaker'}
                                onChange={handleSpeechConfigChange}
                                className="peer h-4 w-4 border-surface text-primary focus:ring-primary bg-input"
                            />
                        </div>
                        <span className="text-sm textPrimary group-hover:text-primary transition-colors">Speaker</span>
                    </label>
                </div>
            </fieldset>

            {/* Gemini Online TTS Configuration */}
            {speechConfig.ttsProvider === 'online' && (
                <GeminiTTSSection
                    speechConfig={speechConfig}
                    llmConfig={llmConfig}
                    onSpeechConfigChange={onSpeechConfigChange}
                    apiKey={apiKey}
                />
            )}

            {/* Kokoro Configuration */}
            {speechConfig.ttsProvider === 'kokoro' && (
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
                                {isImportingKokoro ? 'Importing...' : 'Import bundle from File (.tar.bz2)'}
                            </button>
                        </div>
                    )}

                    {isKokoroReady && (
                        <div className="mt-4 pt-4 border-t border-white/5">
                            <h4 className="text-sm font-semibold textPrimary mb-3">Seleziona Voce</h4>
                            
                            <label className="flex items-center gap-3 p-3 rounded-lg border border-white/5 bg-surface/30 hover:bg-surface/50 cursor-pointer mb-2 transition-colors">
                                <input
                                    type="radio"
                                    name="kokoroVoiceId"
                                    value="if_sara"
                                    checked={speechConfig.kokoroVoiceId === 'if_sara'}
                                    onChange={handleSpeechConfigChange}
                                    className="h-4 w-4 text-purple-500 bg-input border-surface focus:ring-purple-500"
                                />
                                <div>
                                    <span className="font-medium text-sm textPrimary">Sara</span>
                                    <p className="text-xs textSecondary">Italiano (Femminile)</p>
                                </div>
                            </label>

                            <label className="flex items-center gap-3 p-3 rounded-lg border border-white/5 bg-surface/30 hover:bg-surface/50 cursor-pointer mb-2 transition-colors">
                                <input
                                    type="radio"
                                    name="kokoroVoiceId"
                                    value="im_nicola"
                                    checked={speechConfig.kokoroVoiceId === 'im_nicola'}
                                    onChange={handleSpeechConfigChange}
                                    className="h-4 w-4 text-purple-500 bg-input border-surface focus:ring-purple-500"
                                />
                                <div>
                                    <span className="font-medium text-sm textPrimary">Nicola</span>
                                    <p className="text-xs textSecondary">Italiano (Maschile)</p>
                                </div>
                            </label>

                            <div className="h-px bg-white/10 w-full my-3"></div>

                            <label className="flex items-center gap-3 p-3 rounded-lg border border-white/5 bg-surface/30 hover:bg-surface/50 cursor-pointer mb-2 transition-colors">
                                <input
                                    type="radio"
                                    name="kokoroVoiceId"
                                    value="af_sky"
                                    checked={speechConfig.kokoroVoiceId === 'af_sky'}
                                    onChange={handleSpeechConfigChange}
                                    className="h-4 w-4 text-blue-500 bg-input border-surface focus:ring-blue-500"
                                />
                                <div>
                                    <span className="font-medium text-sm textPrimary">Sky</span>
                                    <p className="text-xs textSecondary">English US (Female)</p>
                                </div>
                            </label>

                            <label className="flex items-center gap-3 p-3 rounded-lg border border-white/5 bg-surface/30 hover:bg-surface/50 cursor-pointer mb-2 transition-colors">
                                <input
                                    type="radio"
                                    name="kokoroVoiceId"
                                    value="am_michael"
                                    checked={speechConfig.kokoroVoiceId === 'am_michael'}
                                    onChange={handleSpeechConfigChange}
                                    className="h-4 w-4 text-blue-500 bg-input border-surface focus:ring-blue-500"
                                />
                                <div>
                                    <span className="font-medium text-sm textPrimary">Michael</span>
                                    <p className="text-xs textSecondary">English US (Male)</p>
                                </div>
                            </label>

                            <label className="flex items-center gap-3 p-3 rounded-lg border border-white/5 bg-surface/30 hover:bg-surface/50 cursor-pointer mb-2 transition-colors">
                                <input
                                    type="radio"
                                    name="kokoroVoiceId"
                                    value="bf_emma"
                                    checked={speechConfig.kokoroVoiceId === 'bf_emma'}
                                    onChange={handleSpeechConfigChange}
                                    className="h-4 w-4 text-blue-500 bg-input border-surface focus:ring-blue-500"
                                />
                                <div>
                                    <span className="font-medium text-sm textPrimary">Emma</span>
                                    <p className="text-xs textSecondary">English UK (Female)</p>
                                </div>
                            </label>

                            <label className="flex items-center gap-3 p-3 rounded-lg border border-white/5 bg-surface/30 hover:bg-surface/50 cursor-pointer transition-colors">
                                <input
                                    type="radio"
                                    name="kokoroVoiceId"
                                    value="bm_george"
                                    checked={speechConfig.kokoroVoiceId === 'bm_george'}
                                    onChange={handleSpeechConfigChange}
                                    className="h-4 w-4 text-blue-500 bg-input border-surface focus:ring-blue-500"
                                />
                                <div>
                                    <span className="font-medium text-sm textPrimary">George</span>
                                    <p className="text-xs textSecondary">English UK (Male)</p>
                                </div>
                            </label>
                        </div>
                    )}
                </div>
            )}

            {/* Piper Voices */}
            {speechConfig.ttsProvider === 'piper' && (
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
            )}
        </div>
    );
};

export default TTSSettings;
