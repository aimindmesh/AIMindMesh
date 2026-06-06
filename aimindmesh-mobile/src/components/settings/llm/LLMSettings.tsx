import React from 'react';
import { LLMConfig, AIMindMeshServerSettings } from '../../../types';
import ProviderSelector from './ProviderSelector';
import APIKeyConfig from './APIKeyConfig';
import AdvancedAIFeatures from './AdvancedAIFeatures';
import NativeModelSettings from './NativeModelSettings';
import ServerModelSettings from './ServerModelSettings';
import { triggerHaptic } from '../../../services/native';

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
                onSelect={(provider) => onLlmConfigSave({ ...llmConfig, provider })}
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

            {/* Advanced AI Features */}
            <AdvancedAIFeatures
                llmConfig={llmConfig}
                onLlmConfigSave={onLlmConfigSave}
                serverSettings={serverSettings}
            />

            {/* Native Model Settings */}

            {llmConfig.provider === 'native-gguf' && (
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
