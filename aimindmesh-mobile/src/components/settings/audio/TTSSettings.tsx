import React, { useState, useEffect } from 'react';
import { SpeechConfig, LLMConfig } from '../../../types';
import { triggerHaptic } from '../../../services/native';
import { PIPER_VOICES, piperVoiceExists } from '../../../services/tts/piperVoiceDownloader';
import { GeminiTTSSection } from './tts/GeminiTTSSection';
import { KokoroTTSSection } from './tts/KokoroTTSSection';
import { PiperTTSSection } from './tts/PiperTTSSection';
import { checkKokoroStatus as checkKokoroStatusService } from '../../../services/tts/kokoroModelDownloader';

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
    const [downloadedPiperVoices, setDownloadedPiperVoices] = useState<string[]>([]);
    const [isKokoroReady, setIsKokoroReady] = useState(false);

    useEffect(() => {
        checkDownloadedModels();
        checkKokoroStatus();
    }, [externalPiperVoices]);

    const checkKokoroStatus = async () => {
        const ready = await checkKokoroStatusService();
        setIsKokoroReady(ready);
        // Auto select Kokoro voice ID if missing but ready
        if (ready && speechConfig.ttsProvider === 'kokoro' && !speechConfig.kokoroVoiceId) {
            onSpeechConfigChange({ ...speechConfig, kokoroVoiceId: 'if_sara' });
        }
    };

    const checkDownloadedModels = async () => {
        const downloadedPiper: string[] = [...externalPiperVoices];
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
                <KokoroTTSSection
                    speechConfig={speechConfig}
                    onSpeechConfigChange={onSpeechConfigChange}
                    isKokoroReady={isKokoroReady}
                    onStatusChange={checkKokoroStatus}
                />
            )}

            {/* Piper Voices */}
            {speechConfig.ttsProvider === 'piper' && (
                <PiperTTSSection
                    speechConfig={speechConfig}
                    onSpeechConfigChange={onSpeechConfigChange}
                    onShowLink={onShowLink}
                    downloadedPiperVoices={downloadedPiperVoices}
                    onRefreshVoices={checkDownloadedModels}
                    externalPiperVoices={externalPiperVoices}
                    onExternalPiperVoicesChange={onExternalPiperVoicesChange}
                />
            )}
        </div>
    );
};

export default TTSSettings;
