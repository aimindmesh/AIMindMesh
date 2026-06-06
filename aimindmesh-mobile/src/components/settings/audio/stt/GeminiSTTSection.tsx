import React, { useState, useEffect } from 'react';
import { SpeechConfig } from '../../../../types';
import { fetchGeminiModels } from '../../../../services/llm/providers/geminiProvider';
import { logger } from '../../../../services/logger';

interface GeminiSTTSectionProps {
    speechConfig: SpeechConfig;
    onSpeechConfigChange: (config: SpeechConfig) => void;
    apiKey?: string;
}

const FALLBACK_STT_MODELS = [
    'gemini-2.5-flash-native-audio-preview-09-2025',
    'gemini-2.5-flash-native-audio-preview',
];

const LANGUAGE_OPTIONS = [
    { code: 'it-IT', label: 'Italiano', flag: '🇮🇹' },
    { code: 'en-US', label: 'English', flag: '🇺🇸' },
];

export const GeminiSTTSection: React.FC<GeminiSTTSectionProps> = ({
    speechConfig,
    onSpeechConfigChange,
    apiKey
}) => {
    const [availableModels, setAvailableModels] = useState<string[]>(FALLBACK_STT_MODELS);
    const [isLoadingModels, setIsLoadingModels] = useState(false);

    useEffect(() => {
        if (!apiKey) return;
        setIsLoadingModels(true);
        fetchGeminiModels(apiKey)
            .then(models => {
                // Filter for Live/audio-capable models (best effort)
                const liveModels = models.filter(m =>
                    m.includes('live') || m.includes('native-audio') || m.includes('flash')
                );
                if (liveModels.length > 0) {
                    setAvailableModels(liveModels);
                } else {
                    setAvailableModels(FALLBACK_STT_MODELS);
                }
            })
            .catch(err => {
                logger.log('warn', '[GeminiSTTSection] Failed to fetch models', err);
            })
            .finally(() => setIsLoadingModels(false));
    }, [apiKey]);

    const currentModel = speechConfig.geminiSttModel || FALLBACK_STT_MODELS[0];
    const currentLanguage = speechConfig.geminiSttLanguage || 'it-IT';

    return (
        <div className="space-y-4 bg-surface/30 p-4 rounded-lg border border-blue-500/20">
            <h4 className="text-sm font-semibold text-blue-400 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                Gemini STT Configuration
            </h4>

            {/* Model Picker */}
            <div>
                <label className="text-xs font-medium textSecondary mb-2 block">STT Model</label>
                <div className="relative">
                    <select
                        value={currentModel}
                        onChange={e => onSpeechConfigChange({ ...speechConfig, geminiSttModel: e.target.value })}
                        disabled={isLoadingModels}
                        className="w-full bg-input border border-white/10 rounded-lg px-3 py-2 text-sm textPrimary appearance-none focus:outline-none focus:border-primary/50 disabled:opacity-60"
                    >
                        {availableModels.map(model => (
                            <option key={model} value={model}>{model}</option>
                        ))}
                    </select>
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                        {isLoadingModels ? (
                            <svg className="w-4 h-4 animate-spin text-primary" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                        ) : (
                            <svg className="w-4 h-4 textSecondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                        )}
                    </div>
                </div>
                <p className="text-xs textSecondary mt-1">Used for real-time voice transcription in Voice Chat.</p>
            </div>

            {/* Language Picker */}
            <div>
                <label className="text-xs font-medium textSecondary mb-2 block">Preferred Language</label>
                <div className="grid grid-cols-2 gap-2">
                    {LANGUAGE_OPTIONS.map(lang => (
                        <div
                            key={lang.code}
                            onClick={() => onSpeechConfigChange({ ...speechConfig, geminiSttLanguage: lang.code })}
                            className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                                currentLanguage === lang.code
                                    ? 'bg-primary/10 border-primary/40'
                                    : 'bg-surface/30 border-white/5 hover:border-primary/20'
                            }`}
                        >
                            <span className="text-xl">{lang.flag}</span>
                            <div>
                                <div className="text-sm font-medium textPrimary">{lang.label}</div>
                                <div className="text-xs textSecondary">{lang.code}</div>
                            </div>
                            <input
                                type="radio"
                                readOnly
                                checked={currentLanguage === lang.code}
                                className="ml-auto h-4 w-4 text-primary bg-input border-surface"
                            />
                        </div>
                    ))}
                </div>
                <p className="text-xs textSecondary mt-1">
                    The native audio model auto-detects language, but this controls the response language instruction.
                </p>
            </div>
        </div>
    );
};
