import React, { useState } from 'react';
import { AIMindMeshServerSettings, LLMConfig } from '../../types';
import { isTaskLLMConfigured, streamTaskCompletion, TaskKeys } from '../../services/llm/taskCompletion';
import { describeAIError } from '../../services/llm/aiErrors';

/** Where each provider gives out keys. */
export const KEY_PAGES: Partial<Record<LLMConfig['provider'], string>> = {
    gemini: 'https://aistudio.google.com/apikey',
    openrouter: 'https://openrouter.ai/keys',
    claude: 'https://console.anthropic.com/settings/keys',
    perplexity: 'https://www.perplexity.ai/settings/api',
};

/** A link that opens in the phone's browser, outside the app. */
export const ExternalLink: React.FC<{ href: string; children: React.ReactNode; className?: string }> = ({ href, children, className }) => (
    <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={e => { e.preventDefault(); window.open(href, '_system'); }}
        className={className ?? 'text-primary underline'}
    >
        {children}
    </a>
);

/** How to get a key for the chosen provider, step by step (shown for the remote providers). */
export const AIProviderGuide: React.FC<{ provider: LLMConfig['provider'] }> = ({ provider }) => {
    const box = 'p-3 rounded-xl bg-white/5 border border-white/10 text-xs text-text-secondary space-y-2';
    const link = 'inline-flex px-3 py-2 rounded-lg bg-primary text-white text-xs font-medium no-underline';

    if (provider === 'gemini') {
        return (
            <div className={box}>
                <p className="text-white font-medium">How to get the key (free, two minutes)</p>
                <ol className="list-decimal pl-4 space-y-1">
                    <li>Open Google AI Studio and sign in with your Google account (accept the terms if asked).</li>
                    <li>Tap "Create API key"; if it asks for a project, pick the one offered or create one. Copy the key (it starts with AIza).</li>
                    <li>Paste it in the field, tap "Try the key", then Save.</li>
                </ol>
                <ExternalLink href={KEY_PAGES.gemini!} className={link}>Open Google AI Studio</ExternalLink>
                <p>The free plan has usage limits. Google receives what you send to the assistant, and a meeting only when you ask for its notes or questions.</p>
            </div>
        );
    }
    if (provider === 'openrouter' || provider === 'claude' || provider === 'perplexity') {
        const names = { openrouter: 'OpenRouter', claude: 'Anthropic Console', perplexity: 'Perplexity' };
        return (
            <div className={box}>
                {provider === 'openrouter' && (
                    <p>OpenRouter gives access to many AI models (Claude, GPT, Gemini, Llama) with one key. It is paid by usage: add credit on the site first.</p>
                )}
                <ExternalLink href={KEY_PAGES[provider]!} className={link}>{`Open ${names[provider]}`}</ExternalLink>
            </div>
        );
    }
    return null;
};

/** Checks the settings with a tiny request, so a wrong key shows up now rather than after a meeting. */
export const TestAIButton: React.FC<{ config: LLMConfig; keys: TaskKeys; serverSettings?: AIMindMeshServerSettings }> = ({ config, keys, serverSettings }) => {
    const [state, setState] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
    const [message, setMessage] = useState('');

    const test = async () => {
        setState('testing');
        setMessage('');
        try {
            for await (const _chunk of streamTaskCompletion({
                system: 'Reply with the single word OK.',
                prompt: 'OK?',
                llmConfig: config,
                keys,
                serverSettings,
                maxTokens: 64
            })) { /* any answer is fine */ }
            setState('ok');
        } catch (e) {
            setState('error');
            setMessage(describeAIError(e));
        }
    };

    return (
        <div className="space-y-1">
            <button
                onClick={test}
                disabled={!isTaskLLMConfigured(config, keys, serverSettings) || state === 'testing'}
                className="px-3 py-2 rounded-lg bg-surface border border-white/10 text-white text-xs font-medium disabled:opacity-50"
            >
                {state === 'testing' ? 'Trying…' : 'Try the key'}
            </button>
            {state === 'ok' && <p className="text-xs text-green-400">✓ It works: remember to save.</p>}
            {state === 'error' && <p className="text-xs text-red-400">{`It does not work: ${message}`}</p>}
        </div>
    );
};
