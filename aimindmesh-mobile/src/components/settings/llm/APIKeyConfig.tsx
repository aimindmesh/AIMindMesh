import React from 'react';
import { LLMConfig } from '../../../types';
import { RefreshIcon } from '../../../constants';

interface APIKeyConfigProps {
    llmConfig: LLMConfig;
    onLlmConfigSave: (config: LLMConfig) => void;
    apiKey: string;
    onApiKeyChange: (key: string) => void;
    perplexityApiKey?: string;
    onPerplexityApiKeyChange?: (key: string) => void;
    claudeApiKey?: string;
    onClaudeApiKeyChange?: (key: string) => void;
    openrouterApiKey?: string;
    onOpenRouterApiKeyChange?: (key: string) => void;
    openRouterModels?: any[];
    isFetchingOpenRouterModels?: boolean;
    onRefreshOpenRouterModels?: () => void;
    geminiModels?: string[];
    isFetchingGeminiModels?: boolean;
    onRefreshGeminiModels?: (key?: string) => void;
}

const APIKeyConfig: React.FC<APIKeyConfigProps> = ({
    llmConfig,
    onLlmConfigSave,
    apiKey,
    onApiKeyChange,
    perplexityApiKey,
    onPerplexityApiKeyChange,
    claudeApiKey,
    onClaudeApiKeyChange,
    openrouterApiKey,
    onOpenRouterApiKeyChange,
    openRouterModels,
    isFetchingOpenRouterModels,
    onRefreshOpenRouterModels,
    geminiModels,
    isFetchingGeminiModels,
    onRefreshGeminiModels
}) => {
    const handleLlmChange = (updates: Partial<LLMConfig>) => {
        onLlmConfigSave({ ...llmConfig, ...updates });
    };

    if (llmConfig.provider === 'gemini') {
        const GEMINI_FALLBACK = [
            'gemini-3.5-flash',
            'gemini-3.1-pro',
            'gemini-3.1-flash',
            'gemini-3.1-flash-lite',
            'gemini-3.1-flash-live',
        ];
        const modelsToShow = geminiModels && geminiModels.length > 0 ? geminiModels : GEMINI_FALLBACK;
        const currentModel = llmConfig.geminiModel || 'gemini-3.5-flash';
        return (
            <div className="space-y-4 bg-blue-500/5 p-4 rounded-lg border border-blue-500/20">
                <div>
                    <label htmlFor="apiKey" className="block text-sm font-medium text-text-primary mb-2">
                        Gemini API Key <span className="text-red-400">*</span>
                    </label>
                    <input
                        type="password"
                        name="apiKey"
                        id="apiKey"
                        autoComplete="off"
                        value={apiKey}
                        onChange={(e) => onApiKeyChange(e.target.value)}
                        placeholder="Enter your Gemini API Key"
                        className="block w-full bg-input border-surface rounded-md shadow-sm py-2 px-3 text-text-primary focus:outline-none focus:ring-1 focus:ring-primary font-mono text-sm"
                    />
                    <p className="text-xs text-text-secondary mt-2">
                        Required for Gemini models, Online TTS, and Voice Chat.
                    </p>
                </div>
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <label htmlFor="geminiModel" className="block text-sm font-medium text-text-primary">
                            Model Selection
                        </label>
                        {onRefreshGeminiModels && (
                            <button
                                onClick={() => onRefreshGeminiModels(apiKey)}
                                disabled={isFetchingGeminiModels || !apiKey}
                                className={`p-1 rounded-md hover:bg-white/10 transition-colors ${isFetchingGeminiModels ? 'animate-spin opacity-50' : ''} ${!apiKey ? 'opacity-30 cursor-not-allowed' : ''}`}
                                title={apiKey ? 'Refresh available models' : 'Enter API key first'}
                            >
                                <RefreshIcon className="w-4 h-4 text-blue-400" />
                            </button>
                        )}
                    </div>
                    <select
                        name="geminiModel"
                        id="geminiModel"
                        value={modelsToShow.includes(currentModel) ? currentModel : modelsToShow[0]}
                        onChange={(e) => handleLlmChange({ geminiModel: e.target.value })}
                        className="block w-full bg-input border-surface rounded-md shadow-sm py-2 px-3 text-text-primary focus:outline-none focus:ring-1 focus:ring-primary text-sm"
                    >
                        {modelsToShow.map((m) => (
                            <option key={m} value={m}>{m}</option>
                        ))}
                    </select>
                    <p className="text-xs text-text-secondary mt-1">
                        {geminiModels && geminiModels.length > 0
                            ? `${geminiModels.length} models fetched from your account`
                            : 'Press ↻ after inserting the API key to load available models'}
                    </p>
                </div>
            </div>
        );
    }

    if (llmConfig.provider === 'perplexity') {
        return (
            <div className="space-y-4 bg-teal-500/5 p-4 rounded-lg border border-teal-500/20 animate-fade-in">
                <div>
                    <label htmlFor="perplexityApiKey" className="block text-sm font-medium text-text-primary mb-2">
                        Perplexity API Key <span className="text-red-400">*</span>
                    </label>
                    <input
                        type="password"
                        name="perplexityApiKey"
                        id="perplexityApiKey"
                        autoComplete="off"
                        value={perplexityApiKey || ''}
                        onChange={(e) => onPerplexityApiKeyChange && onPerplexityApiKeyChange(e.target.value)}
                        placeholder="pplx-..."
                        className="block w-full bg-input border-surface rounded-md shadow-sm py-2 px-3 text-text-primary focus:outline-none focus:ring-1 focus:ring-teal-500 font-mono text-sm"
                    />
                    <p className="text-xs text-text-secondary mt-2">
                        Required for Perplexity online search capabilities.
                    </p>
                </div>
                <div>
                    <label htmlFor="perplexityModel" className="block text-sm font-medium text-text-primary mb-2">
                        Model Selection
                    </label>
                    <select
                        name="perplexityModel"
                        id="perplexityModel"
                        value={llmConfig.perplexityModel || 'sonar-pro'}
                        onChange={(e) => handleLlmChange({ perplexityModel: e.target.value })}
                        className="block w-full bg-input border-surface rounded-md shadow-sm py-2 px-3 text-text-primary focus:outline-none focus:ring-1 focus:ring-teal-500 text-sm"
                    >
                        <option value="sonar-pro">Sonar Pro (Default)</option>
                        <option value="sonar-reasoning">Sonar Reasoning (Deep Reasoning)</option>
                        <option value="sonar">Sonar (Fast/Basic)</option>
                    </select>
                </div>
            </div>
        );
    }

    if (llmConfig.provider === 'claude') {
        return (
            <div className="space-y-4 bg-orange-500/5 p-4 rounded-lg border border-orange-500/20 animate-fade-in">
                <div>
                    <label htmlFor="claudeApiKey" className="block text-sm font-medium text-text-primary mb-2">
                        Claude API Key <span className="text-red-400">*</span>
                    </label>
                    <input
                        type="password"
                        name="claudeApiKey"
                        id="claudeApiKey"
                        autoComplete="off"
                        value={claudeApiKey || ''}
                        onChange={(e) => onClaudeApiKeyChange && onClaudeApiKeyChange(e.target.value)}
                        placeholder="sk-ant-..."
                        className="block w-full bg-input border-surface rounded-md shadow-sm py-2 px-3 text-text-primary focus:outline-none focus:ring-1 focus:ring-orange-500 font-mono text-sm"
                    />
                </div>
                <div>
                    <label htmlFor="claudeModel" className="block text-sm font-medium text-text-primary mb-2">
                        Model Selection
                    </label>
                    <select
                        name="claudeModel"
                        id="claudeModel"
                        value={llmConfig.claudeModel || 'claude-sonnet-4-5'}
                        onChange={(e) => handleLlmChange({ claudeModel: e.target.value })}
                        className="block w-full bg-input border-surface rounded-md shadow-sm py-2 px-3 text-text-primary focus:outline-none focus:ring-1 focus:ring-orange-500 text-sm"
                    >
                        <option value="claude-sonnet-4-5">Claude Sonnet 4.5 (New)</option>
                        <option value="claude-haiku-4-5">Claude Haiku 4.5 (Fast)</option>
                        <option value="claude-opus-4-5">Claude Opus 4.5 (Powerful)</option>
                        <option value="claude-3-5-sonnet-latest">Claude 3.5 Sonnet (Legacy)</option>
                        <option value="claude-3-opus-latest">Claude 3 Opus (Legacy)</option>
                    </select>
                </div>
            </div>
        );
    }

    if (llmConfig.provider === 'local') {
        return (
            <div className="space-y-4 bg-blue-500/5 p-4 rounded-lg border border-blue-500/20">
                <div>
                    <label htmlFor="localEndpoint" className="block text-sm font-medium text-text-primary mb-2">
                        Server Endpoint
                    </label>
                    <input
                        type="text"
                        name="localEndpoint"
                        id="localEndpoint"
                        autoComplete="off"
                        value={llmConfig.localEndpoint}
                        onChange={(e) => handleLlmChange({ localEndpoint: e.target.value })}
                        className="block w-full bg-input border-surface rounded-md shadow-sm py-2 px-3 text-text-primary focus:outline-none focus:ring-1 focus:ring-primary font-mono text-sm"
                    />
                    <p className="text-xs text-text-secondary mt-1">
                        For Android Emulator: use <code className="bg-surface px-1 py-0.5 rounded">http://10.0.2.2:11434/v1</code>
                    </p>
                </div>
                <div>
                    <label htmlFor="localModel" className="block text-sm font-medium text-text-primary mb-2">
                        Model Name
                    </label>
                    <input
                        type="text"
                        name="localModel"
                        id="localModel"
                        autoComplete="off"
                        value={llmConfig.localModel}
                        onChange={(e) => handleLlmChange({ localModel: e.target.value })}
                        className="block w-full bg-input border-surface rounded-md shadow-sm py-2 px-3 text-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                </div>
            </div>
        );
    }

    if (llmConfig.provider === 'openrouter') {
        return (
            <div className="space-y-4 bg-violet-500/5 p-4 rounded-lg border border-violet-500/20 animate-fade-in">
                <div>
                    <label htmlFor="openrouterApiKey" className="block text-sm font-medium text-text-primary mb-2">
                        OpenRouter API Key <span className="text-red-400">*</span>
                    </label>
                    <input
                        type="password"
                        name="openrouterApiKey"
                        id="openrouterApiKey"
                        autoComplete="off"
                        value={openrouterApiKey || ''}
                        onChange={(e) => onOpenRouterApiKeyChange && onOpenRouterApiKeyChange(e.target.value)}
                        placeholder="sk-or-v1-..."
                        className="block w-full bg-input border-surface rounded-md shadow-sm py-2 px-3 text-text-primary focus:outline-none focus:ring-1 focus:ring-violet-500 font-mono text-sm"
                    />
                    <p className="text-xs text-text-secondary mt-2">
                        Get your key at{' '}
                        <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="text-violet-400 underline">openrouter.ai/keys</a>.
                        Free tier available.
                    </p>
                </div>
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <label htmlFor="openrouterModel" className="block text-sm font-medium text-text-primary">
                            Model Selection
                        </label>
                        {onRefreshOpenRouterModels && (
                            <button
                                onClick={onRefreshOpenRouterModels}
                                disabled={isFetchingOpenRouterModels}
                                className={`p-1 rounded-md hover:bg-white/10 transition-colors ${isFetchingOpenRouterModels ? 'animate-spin opacity-50' : ''}`}
                                title="Refresh model list"
                            >
                                <RefreshIcon className="w-4 h-4 text-violet-400" />
                            </button>
                        )}
                    </div>
                    <select
                        name="openrouterModel"
                        id="openrouterModel"
                        value={llmConfig.openrouterModel || 'google/gemini-2.0-flash-lite:free'}
                        onChange={(e) => handleLlmChange({ openrouterModel: e.target.value })}
                        className="block w-full bg-input border-surface rounded-md shadow-sm py-2 px-3 text-text-primary focus:outline-none focus:ring-1 focus:ring-violet-500 text-sm"
                    >
                        {openRouterModels && openRouterModels.length > 0 ? (
                            Object.entries(
                                openRouterModels.reduce((acc: any, m: any) => {
                                    const provider = m.id.split('/')[0];
                                    if (!acc[provider]) acc[provider] = [];
                                    acc[provider].push({ label: m.name, value: m.id });
                                    return acc;
                                }, {})
                            ).sort(([a], [b]) => a.localeCompare(b)).map(([provider, options]: [string, any]) => (
                                <optgroup key={provider} label={provider.toUpperCase()}>
                                    {options.sort((a: any, b: any) => a.label.localeCompare(b.label)).map((opt: any) => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                </optgroup>
                            ))
                        ) : (
                            <>
                                <optgroup label="Free Models">
                                    <option value="google/gemini-3.1-flash-lite:free">Gemini 3.1 Flash Lite (Free)</option>
                                    <option value="google/gemini-3.1-flash:free">Gemini 3.1 Flash (Free)</option>
                                    <option value="meta-llama/llama-3.3-70b-instruct:free">Llama 3.3 70B (Free)</option>
                                    <option value="deepseek/deepseek-r1:free">DeepSeek R1 (Free)</option>
                                </optgroup>
                                <optgroup label="Paid Models">
                                    <option value="google/gemini-3.1-pro-preview">Gemini 3.1 Pro</option>
                                    <option value="anthropic/claude-sonnet-4-5">Claude Sonnet 4.5</option>
                                    <option value="openai/gpt-4o-mini">GPT-4o Mini</option>
                                    <option value="openai/gpt-o3-mini">GPT-o3 Mini</option>
                                </optgroup>
                            </>
                        )}
                    </select>
                    <p className="text-xs text-text-secondary mt-1">
                        Browse all models at{' '}
                        <a href="https://openrouter.ai/models" target="_blank" rel="noopener noreferrer" className="text-violet-400 underline">openrouter.ai/models</a>.
                    </p>
                </div>
            </div>
        );
    }

    return null;
};

export default APIKeyConfig;
