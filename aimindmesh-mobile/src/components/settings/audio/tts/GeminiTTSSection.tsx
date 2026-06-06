import React, { useState, useEffect } from 'react';
import { SpeechConfig, LLMConfig } from '../../../../types';
import { fetchGeminiModels } from '../../../../services/llm/providers/geminiProvider';
import { speak } from '../../../../services/tts/speech';
import { logger } from '../../../../services/logger';
import { triggerHaptic } from '../../../../services/native';

interface GeminiTTSSectionProps {
    speechConfig: SpeechConfig;
    llmConfig: LLMConfig;
    onSpeechConfigChange: (config: SpeechConfig) => void;
    apiKey?: string;
}

// All 30 prebuilt Gemini voices grouped by category
const GEMINI_VOICES = [
    { name: 'Kore',         desc: 'Warm, natural' },
    { name: 'Aoede',        desc: 'Bright, expressive' },
    { name: 'Charon',       desc: 'Deep, authoritative' },
    { name: 'Puck',         desc: 'Playful, energetic' },
    { name: 'Zephyr',       desc: 'Light, airy' },
    { name: 'Fenrir',       desc: 'Strong, confident' },
    { name: 'Leda',         desc: 'Gentle, soft' },
    { name: 'Orus',         desc: 'Smooth, calm' },
    { name: 'Callirrhoe',   desc: 'Clear, articulate' },
    { name: 'Autonoe',      desc: 'Steady, measured' },
    { name: 'Enceladus',    desc: 'Resonant, rich' },
    { name: 'Iapetus',      desc: 'Neutral, professional' },
    { name: 'Umbriel',      desc: 'Soft, contemplative' },
    { name: 'Algieba',      desc: 'Warm, conversational' },
    { name: 'Despina',      desc: 'Crisp, precise' },
    { name: 'Erinome',      desc: 'Subtle, refined' },
    { name: 'Algenib',      desc: 'Clear, dynamic' },
    { name: 'Rasalgethi',   desc: 'Deep, measured' },
    { name: 'Laomedeia',    desc: 'Gentle, flowing' },
    { name: 'Achernar',     desc: 'Bright, upbeat' },
    { name: 'Alnilam',      desc: 'Balanced, clear' },
    { name: 'Schedar',      desc: 'Rich, warm' },
    { name: 'Gacrux',       desc: 'Confident, strong' },
    { name: 'Pulcherrima',  desc: 'Elegant, smooth' },
    { name: 'Achird',       desc: 'Friendly, light' },
    { name: 'Zubenelgenubi', desc: 'Calm, grounded' },
    { name: 'Vindemiatrix', desc: 'Precise, neutral' },
    { name: 'Sadachbia',    desc: 'Soft, flowing' },
    { name: 'Sadaltager',   desc: 'Clear, concise' },
    { name: 'Sulafat',      desc: 'Warm, natural' },
];

// Known Gemini TTS models — only these support Modality.AUDIO via generateContent
const TTS_FALLBACK_MODELS = [
    'gemini-2.5-flash-preview-tts',
    'gemini-2.5-pro-preview-tts',
    'gemini-3.1-flash-tts-preview',
];

const GEMINI_TTS_DEFAULT = TTS_FALLBACK_MODELS[0];
const PREVIEW_PHRASES: Record<string, string> = {
    'it-IT': 'Ciao! Questa è una voce di esempio.',
    'en-US': 'Hello! This is a sample voice preview.',
};

export const GeminiTTSSection: React.FC<GeminiTTSSectionProps> = ({
    speechConfig, llmConfig, onSpeechConfigChange, apiKey
}) => {
    const [availableModels, setAvailableModels] = useState<string[]>(TTS_FALLBACK_MODELS);
    const [isLoadingModels, setIsLoadingModels] = useState(false);
    const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);

    const currentModel = speechConfig.geminiTtsModel || GEMINI_TTS_DEFAULT;
    const currentVoice = speechConfig.geminiTtsVoice || 'Kore';
    const previewLang = speechConfig.geminiSttLanguage || 'it-IT';

    useEffect(() => {
        if (!apiKey) return;
        setIsLoadingModels(true);
        fetchGeminiModels(apiKey)
            .then(models => {
                // Only TTS-specific models work with Modality.AUDIO
                const ttsModels = models.filter(m => m.toLowerCase().includes('tts'));
                setAvailableModels(ttsModels.length > 0 ? ttsModels : TTS_FALLBACK_MODELS);
            })
            .catch(err => logger.log('warn', '[GeminiTTSSection] model fetch failed', err))
            .finally(() => setIsLoadingModels(false));
    }, [apiKey]);

    const handlePreview = async (voiceName: string) => {
        if (!apiKey) { alert('API key required for preview.'); return; }
        triggerHaptic();
        setPreviewingVoice(voiceName);
        const previewConfig = { ...speechConfig, geminiTtsVoice: voiceName, geminiTtsModel: currentModel };
        try {
            await new Promise<void>(resolve => {
                speak(
                    PREVIEW_PHRASES[previewLang] || PREVIEW_PHRASES['en-US'],
                    'online',
                    llmConfig,
                    previewConfig,
                    apiKey,
                    resolve
                );
            });
        } catch (e) {
            logger.log('warn', 'Preview failed', e);
        } finally {
            setPreviewingVoice(null);
        }
    };

    return (
        <div className="space-y-4 bg-surface/30 p-4 rounded-lg border border-blue-500/20">
            <h4 className="text-sm font-semibold text-blue-400 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M12 18.364a9 9 0 000-12.728M8.464 15.536a5 5 0 010-7.072" />
                </svg>
                Gemini TTS Configuration
            </h4>

            {/* Model Picker */}
            <div>
                <label className="text-xs font-medium textSecondary mb-2 block">TTS Model</label>
                <div className="relative">
                    <select
                        value={currentModel}
                        onChange={e => onSpeechConfigChange({ ...speechConfig, geminiTtsModel: e.target.value })}
                        disabled={isLoadingModels}
                        className="w-full bg-input border border-white/10 rounded-lg px-3 py-2 text-sm textPrimary appearance-none focus:outline-none focus:border-primary/50 disabled:opacity-60"
                    >
                        {availableModels.map(m => (
                            <option key={m} value={m}>{m}</option>
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
            </div>

            {/* Voice Picker */}
            <div>
                <label className="text-xs font-medium textSecondary mb-2 block">Voice</label>
                <div className="grid grid-cols-1 gap-2 max-h-80 overflow-y-auto pr-1">
                    {GEMINI_VOICES.map(voice => {
                        const isSelected = currentVoice === voice.name;
                        const isPreviewing = previewingVoice === voice.name;
                        return (
                            <div
                                key={voice.name}
                                onClick={() => {
                                    onSpeechConfigChange({ ...speechConfig, geminiTtsVoice: voice.name });
                                    triggerHaptic();
                                }}
                                className={`flex items-center justify-between px-3 py-2 rounded-lg border cursor-pointer transition-all ${
                                    isSelected
                                        ? 'bg-primary/10 border-primary/40'
                                        : 'bg-surface/30 border-white/5 hover:border-primary/20'
                                }`}
                            >
                                <div className="flex items-center gap-3">
                                    <input
                                        type="radio"
                                        readOnly
                                        checked={isSelected}
                                        className="h-4 w-4 text-primary bg-input border-surface flex-shrink-0"
                                    />
                                    <div>
                                        <span className="text-sm font-medium textPrimary">{voice.name}</span>
                                        <span className="text-xs textSecondary ml-2">{voice.desc}</span>
                                    </div>
                                </div>
                                <button
                                    onClick={e => { e.stopPropagation(); handlePreview(voice.name); }}
                                    disabled={!!previewingVoice}
                                    className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 rounded-md transition-colors disabled:opacity-40 flex-shrink-0"
                                    title={`Preview ${voice.name}`}
                                >
                                    {isPreviewing ? (
                                        <svg className="w-3 h-3 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
                                            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                                        </svg>
                                    ) : (
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                    )}
                                    {isPreviewing ? 'Playing...' : 'Preview'}
                                </button>
                            </div>
                        );
                    })}
                </div>
                <p className="text-xs textSecondary mt-2">
                    Click Preview to hear a sample. Language for preview follows STT language setting.
                </p>
            </div>
        </div>
    );
};
