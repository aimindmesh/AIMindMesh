import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useConfigStore, AppConfig } from '../store/configStore';
import { Save, Activity, Terminal, Download, RefreshCw, CheckCircle2, AlertCircle, Sparkles } from 'lucide-react';
import { Dropdown } from '../components/ui/Dropdown';
import { Logger, LogLevel } from '../utils/logger';
import pkg from '../../package.json';
import { openUrl } from '@tauri-apps/plugin-opener';

export default function SettingsView() {
  const { config, setConfig } = useConfigStore();
  const [localConfig, setLocalConfig] = useState<AppConfig | null>(null);
  const [localModels, setLocalModels] = useState<string[]>([]);
  const [openRouterModels, setOpenRouterModels] = useState<any[]>([]);
  const [isFetchingOR, setIsFetchingOR] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [updateStatus, setUpdateStatus] = useState<{
    latestVersion?: string;
    isNewer: boolean;
    deb?: string;
    appimage?: string;
    isLoading: boolean;
    error?: string;
  }>({ isNewer: false, isLoading: false });

  const compareVersions = (v1: string, v2: string) => {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((parts1[i] || 0) > (parts2[i] || 0)) return 1;
      if ((parts1[i] || 0) < (parts2[i] || 0)) return -1;
    }
    return 0;
  };

  const checkUpdates = async (silent = false) => {
    if (!localConfig) return;
    if (!silent) setUpdateStatus((prev: any) => ({ ...prev, isLoading: true, error: undefined }));

    try {
      const url = localConfig.server.url.replace(/\/$/, '') + '/dl/versions.json';
      const resp = await fetch(url, {
        headers: {
          'x-api-key': localConfig.server.api_key,
          'Accept': 'application/json'
        }
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status} (Check VPN/Auth)`);

      const data = await resp.json();
      const latest = data.pc?.version;
      if (!latest) throw new Error('Invalid versions format');

      const current = pkg.version;
      const isNewer = compareVersions(latest, current) > 0;

      setUpdateStatus({
        latestVersion: latest,
        isNewer,
        deb: data.pc.deb,
        appimage: data.pc.appimage,
        isLoading: false
      });

      if (isNewer && !silent) {
        Logger.info('SettingsView', `New version detected: ${latest}`);
      }
    } catch (e: any) {
      if (!silent) {
        setUpdateStatus((prev: any) => ({ ...prev, isLoading: false, error: e.message }));
        Logger.warn('SettingsView', 'Update check failed', e);
      }
    }
  };

  const fetchLocalModels = async () => {
    if (!localConfig) {
      Logger.debug('SettingsView', 'Pulse rejected: cannot update models before initialization');
      return;
    }
    const targetIp = localConfig.node.vpn_ip || ''; // Default: use configured VPN IP
    try {
      // Try VPN IP first, then fallback to localhost
      const resp = await fetch(`http://${targetIp}:11434/api/tags`);
      if (resp.ok) {
        const data = await resp.json();
        const models = data.models?.map((m: any) => m.name) || [];
        setLocalModels(models);
      } else {
        const localResp = await fetch('http://localhost:11434/api/tags');
        if (localResp.ok) {
          const data = await localResp.json();
          const models = data.models?.map((m: any) => m.name) || [];
          setLocalModels(models);
        }
      }
    } catch (e) {
      Logger.warn('SettingsView', 'Ollama not reachable for model listing at VPN IP or localhost', e);
    }
  };

  const fetchOpenRouterModels = async () => {
    setIsFetchingOR(true);
    try {
      const resp = await fetch('https://openrouter.ai/api/v1/models', {
        headers: {
          'HTTP-Referer': 'https://aimindmesh.local',
          'X-Title': 'AIMindMesh'
        }
      });
      if (resp.ok) {
        const data = await resp.json();
        setOpenRouterModels(data.data || []);
      }
    } catch (e) {
      Logger.warn('SettingsView', 'Failed to fetch OpenRouter models', e);
    } finally {
      setIsFetchingOR(false);
    }
  };

  const fetchServerConfig = async (currentLocal: AppConfig) => {
    try {
      const url = currentLocal.server.url.replace(/\/$/, '') + '/api/admin/config';
      const resp = await fetch(url, {
        headers: { 'x-api-key': currentLocal.server.api_key }
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.config) {
          setLocalConfig(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              autoEvolution: data.config.autoEvolution ? {
                ...prev.autoEvolution,
                ...data.config.autoEvolution
              } : prev.autoEvolution,
              gemini: data.config.gemini ? {
                ...prev.gemini,
                ...data.config.gemini
              } : prev.gemini,
              openrouter: data.config.openrouter ? {
                ...prev.openrouter,
                ...data.config.openrouter
              } : prev.openrouter,
              freellmapi: data.config.freellmapi ? {
                ...prev.freellmapi,
                ...data.config.freellmapi
              } : prev.freellmapi
            };
          });
          Logger.info('SettingsView', 'Server configuration fetched and merged successfully');
        }
      }
    } catch (e) {
      Logger.warn('SettingsView', 'Could not fetch remote server configuration', e);
    }
  };

  useEffect(() => {
    if (config) {
      const firstLoad = !localConfig;
      setLocalConfig(config);
      fetchLocalModels();
      if (config.openrouter?.apiKey) {
        fetchOpenRouterModels();
      }
      if (firstLoad) {
        fetchServerConfig(config);
        if (config.updates?.check_automatic) {
          checkUpdates(true);
        }
      }
    }
  }, [config]);

  const handleSave = async () => {
    if (!localConfig) return;
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      await invoke('save_config', { config: localConfig });
      setConfig(localConfig);
      setSaveSuccess(true);
      Logger.info('SettingsView', 'Application configuration persistently saved to disk');

      // Sync with Server if possible
      try {
        const url = localConfig.server.url.replace(/\/$/, '') + '/api/admin/config';
        await fetch(url, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': localConfig.server.api_key
          },
          body: JSON.stringify({ 
            autoEvolution: localConfig.autoEvolution,
            gemini: localConfig.gemini,
            openrouter: localConfig.openrouter,
            freellmapi: localConfig.freellmapi
          })
        });
        Logger.info('SettingsView', 'Server configuration synchronized successfully');
      } catch (err) {
        Logger.warn('SettingsView', 'Failed to sync configuration with server', err);
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (e) {
      Logger.error('SettingsView', 'Failed to save application configuration', e);
    } finally {
      setIsSaving(false);
    }
  };

  const testConnection = async () => {
    if (!localConfig) return;
    setTestStatus('loading');
    setTestMessage('');
    try {
      const url = localConfig.server.url.replace(/\/$/, '') + '/api/nodes';
      const resp = await fetch(url, { headers: { 'x-api-key': localConfig.server.api_key } });
      if (!resp.ok) throw new Error(`HTTP ${resp.status} - Check API Key`);
      const data = await resp.json();
      setTestStatus('ok');
      setTestMessage(`✅ Connected! (Active nodes: ${Object.keys(data.nodes || {}).length})`);
      Logger.info('SettingsView', `Connection test established successfully to ${url}`);
    } catch (e: any) {
      setTestStatus('error');
      setTestMessage(`❌ Connection failed: ${e.message}`);
      Logger.error('SettingsView', `Neural link verification failed for ${localConfig.server.url}`, e);
    }
  };

  if (!localConfig) return <div className="p-6">Loading...</div>;

  return (
    <div className="p-6 h-full flex flex-col gap-6 animate-fade-in overflow-y-auto">
      <div className="flex items-center justify-between max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className={`${saveSuccess ? 'bg-success hover:bg-success/90' : 'bg-primary hover:bg-primary-hover'} text-surface px-4 py-2 rounded-xl flex items-center gap-2 font-semibold transition-all shadow-lg min-w-[140px] justify-center`}
        >
          <Save className="w-4 h-4" />
          {isSaving ? 'Saving...' : (saveSuccess ? 'Config Saved!' : 'Save Config')}
        </button>
      </div>

      <div className="glass-panel rounded-2xl p-8 flex flex-col gap-6 max-w-2xl">
        <h2 className="text-xl font-semibold border-b border-border pb-2">Network Configuration</h2>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-muted-foreground">Server URL</label>
          <input
            type="text"
            value={localConfig.server.url}
            onChange={(e) => setLocalConfig({ ...localConfig, server: { ...localConfig.server, url: e.target.value } })}
            className="bg-background p-3 rounded-lg border border-border outline-none focus:ring-2 focus:ring-primary transition-all"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-muted-foreground">Server API Key</label>
          <input
            type="password"
            value={localConfig.server.api_key}
            onChange={(e) => setLocalConfig({ ...localConfig, server: { ...localConfig.server, api_key: e.target.value } })}
            className="bg-background p-3 rounded-lg border border-border font-mono outline-none focus:ring-2 focus:ring-primary transition-all"
            placeholder="Enter your API Key"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-muted-foreground">VPN Interface IP</label>
          <input
            type="text"
            value={localConfig.node.vpn_ip}
            onChange={(e) => setLocalConfig({ ...localConfig, node: { ...localConfig.node, vpn_ip: e.target.value } })}
            className="bg-background p-3 rounded-lg border border-border font-mono outline-none focus:ring-2 focus:ring-primary transition-all"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-muted-foreground">Node Name</label>
          <input
            type="text"
            value={localConfig.node.name}
            onChange={(e) => setLocalConfig({ ...localConfig, node: { ...localConfig.node, name: e.target.value } })}
            className="bg-background p-3 rounded-lg border border-border font-mono outline-none focus:ring-2 focus:ring-primary transition-all"
            placeholder="e.g. laptop, workstation, desktop"
          />
          <p className="text-xs text-muted-foreground">User-friendly name for this node in the mesh network.</p>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-muted-foreground">System Node ID</label>
          <input
            type="text"
            value={localConfig.node.id}
            className="bg-background p-3 rounded-lg border border-border font-mono outline-none opacity-60 cursor-not-allowed"
            readOnly
          />
          <p className="text-xs text-muted-foreground">Unique persistent identifier generated by the system.</p>
        </div>

        <div className="flex flex-col gap-2 mt-2">
          <button
            onClick={testConnection}
            disabled={testStatus === 'loading'}
            className="bg-secondary/50 hover:bg-secondary text-primary px-4 py-2 rounded-xl flex items-center justify-center gap-2 font-semibold transition-all w-full"
          >
            <Activity className="w-4 h-4" />
            {testStatus === 'loading' ? 'Testing...' : 'Test Connection'}
          </button>

          {testMessage && (
            <div className={`mt-2 text-sm rounded-lg px-3 py-2 border ${testStatus === 'ok' ? 'bg-success/10 border-success/30 text-success' : 'bg-destructive/10 border-destructive/30 text-destructive'}`}>
              {testMessage}
            </div>
          )}
        </div>
      </div>

      <div className="glass-panel rounded-2xl p-8 flex flex-col gap-6 max-w-2xl">
        <h2 className="text-xl font-semibold border-b border-border pb-2">Inference Engine</h2>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-muted-foreground">Local Ollama Model</label>
          <div className="flex gap-2">
            <select
              value={localConfig.ollama.model}
              onChange={(e) => setLocalConfig({ ...localConfig, ollama: { ...localConfig.ollama, model: e.target.value } })}
              className="flex-1 bg-background p-3 rounded-lg border border-border outline-none focus:ring-2 focus:ring-primary transition-all font-mono shadow-sm"
            >
              {localModels.length > 0 ? (
                localModels.map((name: string) => (
                  <option key={name} value={name}>{name}</option>
                ))
              ) : (
                <option value={localConfig.ollama.model}>{localConfig.ollama.model} (Detecting...)</option>
              )}
            </select>
            <button
              onClick={fetchLocalModels}
              className="p-3 bg-secondary/30 hover:bg-secondary/50 rounded-lg transition-all"
              title="Refresh Models"
            >
              <Activity className={`w-4 h-4 ${localModels.length === 0 ? 'animate-pulse' : ''}`} />
            </button>
          </div>
          <p className="text-xs text-muted-foreground">Select the model installed on this PC for local inference.</p>
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={localConfig.ollama.auto_start}
              onChange={(e) => setLocalConfig({ ...localConfig, ollama: { ...localConfig.ollama, auto_start: e.target.checked } })}
              className="w-5 h-5 rounded accent-primary border-border bg-background"
            />
            <span className="font-medium text-sm">Autostart Ollama Background Node</span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={localConfig.ollama.auto_stop_on_exit}
              onChange={(e) => setLocalConfig({ ...localConfig, ollama: { ...localConfig.ollama, auto_stop_on_exit: e.target.checked } })}
              className="w-5 h-5 rounded accent-primary border-border bg-background"
            />
            <span className="font-medium text-sm">Stop Ollama on Application Exit</span>
          </label>

          <div className="h-px bg-border my-1" />

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={localConfig.ui.search_enabled ?? false}
              onChange={(e) => setLocalConfig({ ...localConfig, ui: { ...localConfig.ui, search_enabled: e.target.checked } })}
              className="w-5 h-5 rounded accent-secondary border-border bg-background"
            />
            <span className="font-medium text-sm">Enable Web Search by Default</span>
          </label>
        </div>
      </div>

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

      <div className="glass-panel rounded-2xl p-8 flex flex-col gap-6 max-w-2xl">
        <h2 className="text-xl font-semibold border-b border-border pb-2 flex items-center gap-2">
          🧬 Auto-Evolution (Gitea)
        </h2>

        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={localConfig.autoEvolution?.enabled || false}
              onChange={(e) => setLocalConfig({ ...localConfig, autoEvolution: { ...(localConfig.autoEvolution || {}), enabled: e.target.checked } as any })}
              className="w-5 h-5 rounded accent-primary border-border bg-background"
            />
            <span className="font-medium text-sm">Enable Autonomous Self-Evolution</span>
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-muted-foreground">Gitea Repository Owner</label>
            <input
              type="text"
              value={localConfig.autoEvolution?.giteaRepoOwner || ''}
              onChange={(e) => setLocalConfig({ ...localConfig, autoEvolution: { ...(localConfig.autoEvolution || {}), giteaRepoOwner: e.target.value } as any })}
              className="bg-background p-3 rounded-lg border border-border font-mono outline-none focus:ring-2 focus:ring-primary transition-all"
              placeholder="e.g. your name"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-muted-foreground">Gitea Repository Name</label>
            <input
              type="text"
              value={localConfig.autoEvolution?.giteaRepoName || ''}
              onChange={(e) => setLocalConfig({ ...localConfig, autoEvolution: { ...(localConfig.autoEvolution || {}), giteaRepoName: e.target.value } as any })}
              className="bg-background p-3 rounded-lg border border-border font-mono outline-none focus:ring-2 focus:ring-primary transition-all"
              placeholder="e.g. AIMindMesh"
            />
          </div>
          <div className="flex flex-col gap-2 md:col-span-2">
            <label className="text-sm font-semibold text-muted-foreground">Developer Username (for Gitea)</label>
            <input
              type="text"
              value={localConfig.autoEvolution?.giteaDeveloperUsername || ''}
              onChange={(e) => setLocalConfig({ ...localConfig, autoEvolution: { ...(localConfig.autoEvolution || {}), giteaDeveloperUsername: e.target.value } as any })}
              className="bg-background p-3 rounded-lg border border-border font-mono outline-none focus:ring-2 focus:ring-primary transition-all"
              placeholder="Username for PR assignment"
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">These settings define which repository the server monitors and where it proposes code improvements.</p>
      </div>

      <div className="glass-panel rounded-2xl p-8 flex flex-col gap-6 max-w-2xl mb-8">
        <h2 className="text-xl font-semibold border-b border-border pb-2">Application Preferences</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="flex flex-col gap-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={localConfig.ui.start_minimized}
                onChange={(e) => setLocalConfig({ ...localConfig, ui: { ...localConfig.ui, start_minimized: e.target.checked } })}
                className="w-5 h-5 rounded accent-primary border-border bg-background"
              />
              <span className="font-medium text-sm">Start Minimized to Tray</span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={localConfig.ui.start_with_system}
                onChange={(e) => setLocalConfig({ ...localConfig, ui: { ...localConfig.ui, start_with_system: e.target.checked } })}
                className="w-5 h-5 rounded accent-primary border-border bg-background"
              />
              <span className="font-medium text-sm">Launch on System Startup</span>
            </label>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-muted-foreground">Theme Mode</label>
            <select
              value={localConfig.ui.theme}
              onChange={(e) => setLocalConfig({ ...localConfig, ui: { ...localConfig.ui, theme: e.target.value } })}
              className="bg-background p-3 rounded-lg border border-border outline-none focus:ring-2 focus:ring-primary transition-all shadow-sm"
            >
              <option value="system">Follow System</option>
              <option value="dark">Dark Aura</option>
              <option value="light">Pure Light</option>
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
              <Terminal className="w-3.5 h-3.5" /> Client Log Level
            </label>
            <select
              value={localConfig.logging?.level || 'INFO'}
              onChange={(e) => {
                const newLevel = e.target.value as LogLevel;
                setLocalConfig({ ...localConfig, logging: { level: newLevel } });
                Logger.setLevel(newLevel);
              }}
              className="bg-background p-3 rounded-lg border border-border outline-none focus:ring-2 focus:ring-primary transition-all shadow-sm font-bold"
            >
              <option value="DEBUG">DEBUG (All traces)</option>
              <option value="INFO">INFO (Standard events)</option>
              <option value="WARN">WARN (Issues only)</option>
              <option value="ERROR">ERROR (Failures only)</option>
            </select>
          </div>
        </div>
      </div>

      <div className="glass-panel rounded-2xl p-8 flex flex-col gap-6 max-w-2xl mb-8">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <h2 className="text-xl font-semibold">Software Updates</h2>
          <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground bg-secondary/30 px-2 py-1 rounded">
            Current: v{pkg.version}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={localConfig.updates?.check_automatic}
                onChange={(e) => setLocalConfig({ ...localConfig, updates: { ...localConfig.updates, check_automatic: e.target.checked } })}
                className="w-5 h-5 rounded accent-primary border-border bg-background"
              />
              <span className="font-medium text-sm">Automatically Check for Updates</span>
            </label>

            <button
              onClick={() => checkUpdates(false)}
              disabled={updateStatus.isLoading}
              className="p-2 hover:bg-secondary/50 rounded-lg transition-all text-primary flex items-center gap-2 text-sm font-semibold"
            >
              <RefreshCw className={`w-4 h-4 ${updateStatus.isLoading ? 'animate-spin' : ''}`} />
              Check Now
            </button>
          </div>

          {updateStatus.error && (
            <div className="bg-destructive/10 border border-destructive/30 text-destructive p-3 rounded-lg flex items-center gap-2 text-sm">
              <AlertCircle className="w-4 h-4" />
              {updateStatus.error}
            </div>
          )}

          {updateStatus.latestVersion && !updateStatus.isNewer && !updateStatus.error && (
            <div className="bg-success/10 border border-success/30 text-success p-3 rounded-lg flex items-center gap-2 text-sm">
              <CheckCircle2 className="w-4 h-4" />
              You are running the latest version (v{pkg.version})
            </div>
          )}

          {updateStatus.isNewer && (
            <div className="bg-primary/10 border border-primary/30 p-4 rounded-xl flex flex-col gap-4 animate-pulse-subtle">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/20 rounded-lg">
                  <Download className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-bold text-primary">Update Available: v{updateStatus.latestVersion}</h3>
                  <p className="text-xs text-muted-foreground">A new version of AIMindMesh is ready for download.</p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                {updateStatus.deb && (
                  <a
                    href={`${localConfig.server.url.replace(/\/$/, '')}/dl/${updateStatus.deb}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 bg-primary text-surface px-4 py-2.5 rounded-lg text-center text-sm font-bold hover:bg-primary-hover transition-all flex items-center justify-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    Download .DEB
                  </a>
                )}
                {updateStatus.appimage && (
                  <a
                    href={`${localConfig.server.url.replace(/\/$/, '')}/dl/${updateStatus.appimage}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 bg-secondary text-primary px-4 py-2.5 rounded-lg text-center text-sm font-bold hover:bg-secondary/80 transition-all flex items-center justify-center gap-2 border border-primary/20"
                  >
                    <Download className="w-4 h-4" />
                    Download .AppImage
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
