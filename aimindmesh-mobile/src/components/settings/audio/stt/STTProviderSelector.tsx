import React from 'react';
import { SpeechConfig } from '../../../../types';
import { triggerHaptic } from '../../../../services/native';

interface STTProviderSelectorProps {
    speechConfig: SpeechConfig;
    onSpeechConfigChange: (config: SpeechConfig) => void;
}

const STTProviderSelector: React.FC<STTProviderSelectorProps> = ({ speechConfig, onSpeechConfigChange }) => {
    const handleSpeechConfigChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        onSpeechConfigChange({ ...speechConfig, [name]: value });
    };

    const options = [
        {
            id: 'vosk',
            label: 'Vosk/Whisper (Offline)',
            desc: 'Completely offline. Fast. Requires model download.',
            badge: 'Private',
            badgeColor: 'bg-green-500/20 text-green-400 border-green-500/30'
        },
        {
            id: 'voxtral',
            label: 'Voxtral Mini 4B (Offline)',
            desc: 'High-quality real-time STT. Requires 2.5-3.2GB RAM.',
            badge: 'Premium',
            badgeColor: 'bg-purple-500/20 text-purple-400 border-purple-500/30'
        },
        {
            id: 'online',
            label: 'Gemini (Online)',
            desc: 'High accuracy. Requires internet & API Key.',
            badge: 'Online',
            badgeColor: 'bg-blue-500/20 text-blue-400 border-blue-500/30'
        }
    ];

    return (
        <fieldset>
            <legend className="text-base font-medium textPrimary mb-3">Speech-to-Text (STT) Provider</legend>

            <div className="grid grid-cols-1 gap-3">
                {options.map(option => (
                    <div
                        key={option.id}
                        className={`flex items-start p-3 rounded-lg border transition-all cursor-pointer ${speechConfig.sttProvider === option.id
                            ? 'bg-primary/10 border-primary/40'
                            : 'bg-surface/30 border-white/5 hover:border-primary/20'
                            }`}
                        onClick={() => {
                            onSpeechConfigChange({ ...speechConfig, sttProvider: option.id as any });
                            triggerHaptic();
                        }}
                    >
                        <input
                            id={`stt_${option.id}`}
                            name="sttProvider"
                            type="radio"
                            value={option.id}
                            checked={speechConfig.sttProvider === option.id}
                            onChange={handleSpeechConfigChange}
                            className="h-4 w-4 mt-0.5 text-primary bg-input border-surface focus:ring-primary flex-shrink-0"
                        />
                        <label htmlFor={`stt_${option.id}`} className="ml-3 flex-1 cursor-pointer">
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
    );
};

export default STTProviderSelector;
