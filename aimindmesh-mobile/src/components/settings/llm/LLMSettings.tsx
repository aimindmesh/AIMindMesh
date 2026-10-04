import React from 'react';
import { LLMConfig, AIMindMeshServerSettings } from '../../../types';
import ProviderSelector from './ProviderSelector';
import APIKeyConfig from './APIKeyConfig';
import AdvancedAIFeatures from './AdvancedAIFeatures';
import NativeModelSettings from './NativeModelSettings';
import ServerModelSettings from './ServerModelSettings';
import { triggerHaptic } from '../../../services/native';
import { AIProviderGuide, TestAIButton } from '../AIProviderGuide';

const KEY_PROVIDERS: LLMConfig['provider'][] = ['gemini', 'openrouter', 'claude', 'perplexity'];

interface LLMSettingsProps {
    llmConfig: LLMConfig;
    onLlmConfigSave: (newConfig: LLMConfig) => void;
    apiKey: string;
    onApiKeyChange: (key: string) => void;
    perplexityApiKey?: string;
    onPerplexityApiKeyChange?: (key: string) => void;
    claudeApiKey?: string;
    onClaudeApiKeyChange?: (key: string) => void;
    openrouterApiKey?: string;
    onOpenRouterApiKeyChange?: (key: string) => void;
    hfToken: string;
    onHfTokenChange: (token: string) => void;
    openRouterModels?: any[];
    isFetchingOpenRouterModels?: boolean;
    onRefreshOpenRouterModels?: () => void;
    geminiModels?: string[];
    isFetchingGeminiModels?: boolean;
    onRefreshGeminiModels?: (key?: string) => void;
    serverSettings?: AIMindMeshServerSettings;
}

const LLMSettings: React.FC<LLMSettingsProps> = ({
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
    hfToken,
    onHfTokenChange,
    openRouterModels,
    isFetchingOpenRouterModels,
    onRefreshOpenRouterModels,
    geminiModels,
    isFetchingGeminiModels,
    onRefreshGeminiModels,
    serverSettings
}) => {
    return (
        <div className="space-y-6 animate-fade-in">
            {/* Provider Categories */}
            <ProviderSelector
                currentProvider={llmConfig.provider}
                onSelect={(provider) => {
                    const engine = provider === 'genie-npu' ? 'genie' : (llmConfig.engine === 'genie' ? 'gguf' : llmConfig.engine);
                    onLlmConfigSave({ ...llmConfig, provider, engine });
                }}
                serverSettings={serverSettings}
            />

            {/* Provider-Specific Configuration */}
            <APIKeyConfig
                llmConfig={llmConfig}
                onLlmConfigSave={onLlmConfigSave}
                apiKey={apiKey}
                onApiKeyChange={onApiKeyChange}
                perplexityApiKey={perplexityApiKey}
                onPerplexityApiKeyChange={onPerplexityApiKeyChange}
                claudeApiKey={claudeApiKey}
                onClaudeApiKeyChange={onClaudeApiKeyChange}
                openrouterApiKey={openrouterApiKey}
                onOpenRouterApiKeyChange={onOpenRouterApiKeyChange}
                openRouterModels={openRouterModels}
                isFetchingOpenRouterModels={isFetchingOpenRouterModels}
                onRefreshOpenRouterModels={onRefreshOpenRouterModels}
                geminiModels={geminiModels}
                isFetchingGeminiModels={isFetchingGeminiModels}
                onRefreshGeminiModels={onRefreshGeminiModels}
            />

            {/* Where to get the key, and a quick check so a wrong one shows up now */}
            {KEY_PROVIDERS.includes(llmConfig.provider) && (
                <div className="space-y-3">
                    <AIProviderGuide provider={llmConfig.provider} />
                    <TestAIButton
                        config={{ ...llmConfig, openrouterApiKey: openrouterApiKey ?? llmConfig.openrouterApiKey }}
                        keys={{ gemini: apiKey, claude: claudeApiKey, perplexity: perplexityApiKey }}
                        serverSettings={serverSettings}
                    />
                </div>
            )}

            {/* Advanced AI Features */}
            <AdvancedAIFeatures
                llmConfig={llmConfig}
                onLlmConfigSave={onLlmConfigSave}
                serverSettings={serverSettings}
            />

            {/* Native Model Settings */}
            {(llmConfig.provider === 'native-gguf' || llmConfig.provider === 'genie-npu') && (
                <NativeModelSettings
                    llmConfig={llmConfig}
                    onLlmConfigSave={onLlmConfigSave}
                    hfToken={hfToken}
                    onHfTokenChange={onHfTokenChange}
                    triggerHaptic={triggerHaptic}
                />
            )}

            {llmConfig.provider === 'aimindmesh-server' && (
                <ServerModelSettings llmConfig={llmConfig} />
            )}
        </div>
    );
};

export default LLMSettings;
