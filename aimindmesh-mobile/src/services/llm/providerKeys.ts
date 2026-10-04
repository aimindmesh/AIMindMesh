/**
 * Provider facts shared by the chat and the background work: which providers run on the
 * device, and the API key each one needs (a key is never sent to another vendor's API).
 */
import { LLMConfig, AIMindMeshServerSettings, DEFAULT_AIMINDMESH_SERVER_SETTINGS } from '../../types';
import { readSetting } from '../security/secretStore';

/** On-device engines: one conversation at a time, small context windows */
export const ON_DEVICE_PROVIDERS = ['native-gguf', 'litert', 'genie-npu'];

export function isOnDeviceProvider(provider: string | undefined | null): boolean {
    return !!provider && ON_DEVICE_PROVIDERS.includes(provider);
}

/** Providers that cannot generate without their own API key */
export const KEYED_PROVIDERS = ['gemini', 'perplexity', 'claude', 'openrouter'];

/** Storage key of each provider's API key (the settings keep it in the secret store) */
const KEY_SETTINGS: Record<string, string> = {
    gemini: 'gemini-api-key',
    perplexity: 'perplexity-api-key',
    claude: 'claude-api-key',
};

/** Provider that actually answers: the server's fallback when the server is the provider. */
export function resolveEffectiveProvider(llmConfig: Pick<LLMConfig, 'provider'>, serverSettings?: AIMindMeshServerSettings): string {
    return llmConfig.provider === 'aimindmesh-server'
        ? (serverSettings?.fallbackProvider ?? 'none')
        : llmConfig.provider;
}

/** Stored API key of `provider` (undefined for providers that need none). */
export function storedApiKeyFor(provider: string, llmConfig?: Pick<LLMConfig, 'openrouterApiKey'>): string | undefined {
    if (provider === 'openrouter') return llmConfig?.openrouterApiKey || undefined;
    const setting = KEY_SETTINGS[provider];
    return setting ? (readSetting<string>(setting, '') || undefined) : undefined;
}

/** Settings as App stores them, for work that runs outside React (background tasks). */
export function readStoredLlmConfig(): LLMConfig | null {
    return readSetting<LLMConfig | null>('llm-config', null);
}

export function readStoredServerSettings(): AIMindMeshServerSettings {
    return readSetting<AIMindMeshServerSettings>('aimindmesh-server-settings', DEFAULT_AIMINDMESH_SERVER_SETTINGS);
}
