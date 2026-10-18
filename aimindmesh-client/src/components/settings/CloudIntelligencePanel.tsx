import { RefreshCw, Sparkles } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Dropdown } from '../ui/Dropdown';
import type { AppConfig } from '../../store/configStore';

interface CloudIntelligencePanelProps {
  localConfig: AppConfig;
  setLocalConfig: (config: AppConfig) => void;
  openRouterModels: any[];
  isFetchingOR: boolean;
  fetchOpenRouterModels: () => void;
}

/** Cloud providers of the server: Gemini key, FreeLLMAPI proxy, OpenRouter key and model. */
export function CloudIntelligencePanel({ localConfig, setLocalConfig, openRouterModels, isFetchingOR, fetchOpenRouterModels }: CloudIntelligencePanelProps) {
  return (
    <div className="glass-panel rounded-2xl p-8 flex flex-col gap-6 max-w-2xl">
      <h2 className="text-xl font-semibold border-b border-border pb-2 flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-primary" /> Cloud Intelligence
      </h2>

      <div className="flex flex-col gap-4">
        <h3 className="text-sm font-bold uppercase tracking-widest opacity-40">Google Gemini</h3>
        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-muted-foreground">API Key</label>
          <input
            type="password"
            value={localConfig.gemini?.apiKey || ''}
            onChange={(e) => setLocalConfig({ ...localConfig, gemini: { ...(localConfig.gemini || {}), apiKey: e.target.value } })}
            className="bg-background p-3 rounded-lg border border-border font-mono outline-none focus:ring-2 focus:ring-primary transition-all"
            placeholder="Paste your Gemini API Key"
          />
        </div>
      </div>

      <div className="h-px bg-border" />

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-widest opacity-40">FreeLLMAPI (Proxy Gateway)</h3>
          <button 
            onClick={() => openUrl(localConfig.freellmapi?.baseUrl || 'http://10.2.0.54:3001')}
            className="text-xs px-3 py-1 bg-primary/10 text-primary font-bold rounded-lg hover:bg-primary/20 transition-all"
          >
            Open Web UI
          </button>
        </div>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={localConfig.freellmapi?.enabled || false}
            onChange={(e) => setLocalConfig({ ...localConfig, freellmapi: { ...(localConfig.freellmapi || { baseUrl: 'http://10.2.0.54:3001', apiKey: '', timeoutMs: 120000, model: 'auto', enabled: false }), enabled: e.target.checked } })}
            className="w-5 h-5 rounded accent-primary border-border bg-background"
          />
          <span className="font-medium text-sm">Enable FreeLLMAPI</span>
        </label>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-muted-foreground">Base URL</label>
          <input
            type="text"
            value={localConfig.freellmapi?.baseUrl || 'http://10.2.0.54:3001'}
            onChange={(e) => setLocalConfig({ ...localConfig, freellmapi: { ...(localConfig.freellmapi || { baseUrl: 'http://10.2.0.54:3001', apiKey: '', timeoutMs: 120000, model: 'auto', enabled: false }), baseUrl: e.target.value } })}
            className="bg-background p-3 rounded-lg border border-border font-mono outline-none focus:ring-2 focus:ring-primary transition-all"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-muted-foreground">API Key</label>
          <input
            type="password"
            value={localConfig.freellmapi?.apiKey || ''}
            onChange={(e) => setLocalConfig({ ...localConfig, freellmapi: { ...(localConfig.freellmapi || { baseUrl: 'http://10.2.0.54:3001', apiKey: '', timeoutMs: 120000, model: 'auto', enabled: false }), apiKey: e.target.value } })}
            className="bg-background p-3 rounded-lg border border-border font-mono outline-none focus:ring-2 focus:ring-primary transition-all"
            placeholder="Your unified FreeLLMAPI Key"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-muted-foreground">Preferred Model</label>
          <input
            type="text"
            value={localConfig.freellmapi?.model || 'auto'}
            onChange={(e) => setLocalConfig({ ...localConfig, freellmapi: { ...(localConfig.freellmapi || { baseUrl: 'http://10.2.0.54:3001', apiKey: '', timeoutMs: 120000, model: 'auto', enabled: false }), model: e.target.value } })}
            className="bg-background p-3 rounded-lg border border-border font-mono outline-none focus:ring-2 focus:ring-primary transition-all"
            placeholder="e.g. auto"
          />
        </div>
      </div>

      <div className="h-px bg-border" />

      <div className="flex flex-col gap-4">
        <h3 className="text-sm font-bold uppercase tracking-widest opacity-40">OpenRouter</h3>
        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-muted-foreground">API Key</label>
          <input
            type="password"
            value={localConfig.openrouter?.apiKey || ''}
            onChange={(e) => setLocalConfig({ ...localConfig, openrouter: { ...(localConfig.openrouter || {}), apiKey: e.target.value } })}
            className="bg-background p-3 rounded-lg border border-border font-mono outline-none focus:ring-2 focus:ring-primary transition-all"
            placeholder="Paste your OpenRouter API Key"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-muted-foreground">Default Model</label>
          <div className="flex gap-2">
            <Dropdown
              value={localConfig.openrouter?.model || ''}
              onChange={(val) => setLocalConfig({ ...localConfig, openrouter: { ...(localConfig.openrouter || {}), model: val } })}
              options={Object.entries(
                openRouterModels.reduce((acc: any, m: any) => {
                  const provider = m.id.split('/')[0];
                  if (!acc[provider]) acc[provider] = [];
                  acc[provider].push({ label: m.name, value: m.id });
                  return acc;
                }, {})
              ).sort().map(([provider, options]: [string, any]) => ({
                label: provider.toUpperCase(),
                options: options.sort((a: any, b: any) => a.label.localeCompare(b.label))
              }))}
              className="flex-1 font-mono"
            />
            <button
              onClick={fetchOpenRouterModels}
              className="p-3 bg-secondary/30 hover:bg-secondary/50 rounded-lg transition-all"
              disabled={isFetchingOR}
            >
              <RefreshCw className={`w-4 h-4 ${isFetchingOR ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <p className="text-xs text-muted-foreground">Models are grouped by provider. Use the refresh button to update the list.</p>
        </div>
      </div>
    </div>
  );
}
