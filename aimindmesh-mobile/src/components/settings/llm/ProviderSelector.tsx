import React from 'react';
import { LLMProvider, AIMindMeshServerSettings } from '../../../types';
import { triggerHaptic } from '../../../services/native';

interface ProviderSelectorProps {
    currentProvider: LLMProvider;
    onSelect: (provider: LLMProvider) => void;
    serverSettings?: AIMindMeshServerSettings;
}

const ProviderSelector: React.FC<ProviderSelectorProps> = ({ currentProvider, onSelect, serverSettings }) => {
    return (
        <fieldset>
            <div className="flex justify-between items-center mb-4">
                <legend className="text-lg font-medium text-text-primary">LLM Provider</legend>
                {serverSettings?.enabled && serverSettings?.useAsDefaultProvider && (
                    <div className="flex items-center gap-2 px-2 py-1 rounded bg-purple-500/10 border border-purple-500/30">
                        <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse"></span>
                        <span className="text-[10px] font-bold text-purple-400 uppercase tracking-tight">Distributed Active</span>
                    </div>
                )}
            </div>

            {/* ONLINE Section */}
            <div className="mb-6">
                <h4 className="text-xs font-semibold text-blue-400/80 uppercase mb-3 flex items-center gap-2">
                    ☁️ Online Models
                </h4>
                <div className="space-y-3 pl-2 border-l-2 border-blue-500/30">
                    {[
                        {
                            id: 'gemini',
                            label: 'Gemini',
                            desc: 'Google AI. Fast & reliable. Requires API Key.',
                            badge: 'Fast',
                            badgeColor: 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                        },
                        {
                            id: 'perplexity',
                            label: 'Perplexity',
                            desc: 'Real-time knowledge. Requires API Key.',
                            badge: 'Knowledge',
                            badgeColor: 'bg-teal-500/20 text-teal-400 border-teal-500/30'
                        },
                        {
                            id: 'claude',
                            label: 'Claude (Anthropic)',
                            desc: 'Nuanced & creative. Requires API Key.',
                            badge: 'Smart',
                            badgeColor: 'bg-orange-500/20 text-orange-400 border-orange-500/30'
                        },
                        {
                            id: 'openrouter',
                            label: 'OpenRouter',
                            desc: 'Access 200+ models with a single API key.',
                            badge: 'Multi-Model',
                            badgeColor: 'bg-violet-500/20 text-violet-400 border-violet-500/30'
                        }
                    ].map(option => (
                        <div
                            key={option.id}
                            className={`flex items-start p-3 rounded-lg border transition-all cursor-pointer ${currentProvider === option.id
                                ? 'bg-blue-500/10 border-blue-500/40'
                                : 'bg-surface/30 border-white/5 hover:border-blue-500/20'
                                }`}
                            onClick={() => {
                                onSelect(option.id as LLMProvider);
                                triggerHaptic();
                            }}
                        >
                            <input
                                id={`provider_${option.id}`}
                                name="provider"
                                type="radio"
                                value={option.id}
                                checked={currentProvider === option.id}
                                onChange={() => onSelect(option.id as LLMProvider)}
                                className="h-4 w-4 mt-0.5 text-blue-500 bg-input border-surface focus:ring-blue-500 flex-shrink-0"
                                onClick={(e) => e.stopPropagation()}
                            />
                            <label htmlFor={`provider_${option.id}`} className="ml-3 flex-1 cursor-pointer">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="font-medium text-text-primary">{option.label}</span>
                                    {option.badge && (
                                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${option.badgeColor}`}>
                                            {option.badge}
                                        </span>
                                    )}
                                </div>
                                <span className="text-xs text-text-secondary">{option.desc}</span>
                            </label>
                        </div>
                    ))}
                </div>
            </div>

            {/* OFFLINE Section */}
            <div>
                <h4 className="text-xs font-semibold text-green-400/80 uppercase mb-3 flex items-center gap-2">
                    🔒 Offline / Private Models
                </h4>
                <div className="space-y-3 pl-2 border-l-2 border-green-500/30">
                    {[
                        {
                            id: 'native-gguf',
                            label: 'Native Offline',
                            desc: 'Runs on device (llama.cpp/LiteRT). Complete privacy.',
                            badge: 'Private',
                            badgeColor: 'bg-green-500/20 text-green-400 border-green-500/30'
                        },
                        {
                            id: 'local',
                            label: 'Local Server',
                            desc: 'Connect to Ollama/LM Studio on your network.',
                            badge: 'Network',
                            badgeColor: 'bg-gray-500/20 text-gray-400 border-gray-500/30'
                        },
                    ].map(option => (
                        <div
                            key={option.id}
                            className={`flex items-start p-3 rounded-lg border transition-all cursor-pointer ${currentProvider === option.id
                                ? 'bg-green-500/10 border-green-500/40'
                                : 'bg-surface/30 border-white/5 hover:border-green-500/20'
                                }`}
                            onClick={() => {
                                onSelect(option.id as LLMProvider);
                                triggerHaptic();
                            }}
                        >
                            <input
                                id={`provider_${option.id}`}
                                name="provider"
                                type="radio"
                                value={option.id}
                                checked={currentProvider === option.id}
                                onChange={() => onSelect(option.id as LLMProvider)}
                                className="h-4 w-4 mt-0.5 text-green-500 bg-input border-surface focus:ring-green-500 flex-shrink-0"
                                onClick={(e) => e.stopPropagation()}
                            />
                            <label htmlFor={`provider_${option.id}`} className="ml-3 flex-1 cursor-pointer">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="font-medium text-text-primary">
                                        {option.label}
                                    </span>
                                    {option.badge && (
                                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${option.badgeColor}`}>
                                            {option.badge}
                                        </span>
                                    )}
                                </div>
                                <span className="text-xs text-text-secondary">
                                    {option.desc}
                                </span>
                            </label>
                        </div>
                    ))}
                </div>
            </div>
        </fieldset>
    );
};

export default ProviderSelector;
