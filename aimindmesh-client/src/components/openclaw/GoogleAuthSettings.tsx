import React, { useState, useEffect } from 'react';
import { agentApi, OpenClawGoogleAuthConfig } from '../../services/serverApi';
import { Shield, Key, RefreshCcw, Save, AlertTriangle, ExternalLink, CheckCircle2 } from 'lucide-react';

export const GoogleAuthSettings: React.FC = () => {
  const [config, setConfig] = useState<OpenClawGoogleAuthConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [requiresRestart, setRequiresRestart] = useState(false);

  // Form states
  const [mode, setMode] = useState<'api_key' | 'oauth'>('api_key');
  const [apiKey, setApiKey] = useState('');
  const [primaryModel, setPrimaryModel] = useState('');

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const res = await agentApi.getGoogleAuth();
      setConfig(res.data);
      setMode(res.data.mode);
      setPrimaryModel(res.data.primaryModel);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load Google Auth configuration');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSuccess(false);
    setError(null);
    try {
      const res = await agentApi.setGoogleAuth({
        mode,
        apiKey: mode === 'api_key' && apiKey ? apiKey : undefined,
        primaryModel,
      });
      setSuccess(true);
      setRequiresRestart(res.data.requiresRestart);
      // Refresh config to get masked keys if changed
      await fetchConfig();
      if (mode === 'api_key') setApiKey(''); // Clear the interactive field
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <RefreshCcw className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header Info */}
      <div className="bg-surface-2/30 border border-border rounded-3xl p-6 backdrop-blur-sm">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-primary/10 rounded-2xl">
            <Shield className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h3 className="text-xl font-bold tracking-tight">Google AI Authentication</h3>
            <p className="text-muted-foreground text-sm mt-1 max-w-2xl">
              Configure how OpenClaw connects to Google models. Switch between API Key for direct billing or OAuth to use your Google One AI Pro subscription.
            </p>
          </div>
        </div>
      </div>

      {requiresRestart && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-center gap-4 text-amber-500 animate-pulse">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <div className="text-sm font-semibold">
            Restart Required: Run <code className="bg-amber-500/20 px-1.5 py-0.5 rounded">docker compose restart openclaw-gateway</code> on your VPS to apply changes.
          </div>
        </div>
      )}

      {success && !requiresRestart && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4 flex items-center gap-4 text-emerald-500">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <div className="text-sm font-semibold">Settings saved successfully.</div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Auth Mode Selection */}
        <div className="space-y-6">
          <div className="space-y-4">
            <label className="text-sm font-bold uppercase tracking-wider text-muted-foreground ml-1">Authentication Mode</label>
            <div className="grid grid-cols-1 gap-3">
              {[
                { id: 'api_key', label: 'API Key', desc: 'Google AI Studio (Pay-per-token)', icon: Key },
                { id: 'oauth', label: 'OAuth (Gemini CLI)', desc: 'Google One AI Pro Subscription', icon: Shield },
              ].map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMode(m.id as any)}
                  className={`flex items-center gap-4 p-5 rounded-3xl border-2 transition-all text-left overflow-hidden relative group ${
                    mode === m.id
                      ? 'border-primary bg-primary/5 shadow-lg shadow-primary/5'
                      : 'border-border bg-surface hover:border-border-hover'
                  }`}
                >
                  <div className={`p-3 rounded-2xl ${mode === m.id ? 'bg-primary text-white' : 'bg-surface-2 text-muted-foreground'}`}>
                    <m.icon className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-bold">{m.label}</div>
                    <div className="text-xs text-muted-foreground">{m.desc}</div>
                  </div>
                  {mode === m.id && (
                    <div className="absolute right-0 top-0 h-full w-1 bg-primary" />
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <label className="text-sm font-bold uppercase tracking-wider text-muted-foreground ml-1">Default Model</label>
            <select
              value={primaryModel}
              onChange={(e) => setPrimaryModel(e.target.value)}
              className="w-full bg-surface border-2 border-border rounded-2xl px-5 py-3 focus:border-primary outline-none font-medium transition-colors"
            >
              {mode === 'api_key' ? (
                <>
                  <option value="google/gemini-3.1-pro-preview">Gemini 3.1 Pro (Preview)</option>
                  <option value="google/gemini-3.1-flash-lite-preview">Gemini 3.1 Flash Lite (Preview)</option>
                  <option value="google/gemini-3.1-flash-image-preview">Gemini 3.1 Flash Image (Nano Banana 2)</option>
                  <option value="google/gemini-3-flash-preview">Gemini 3 Flash (Preview)</option>
                  <option value="google/gemini-3-pro-image-preview">Gemini 3 Pro Image (Nano Banana Pro)</option>
                </>
              ) : (
                <>
                  <option value="google-gemini-cli/gemini-3.1-pro-preview">Gemini 3.1 Pro (via CLI)</option>
                  <option value="google-gemini-cli/gemini-3.1-flash-lite-preview">Gemini 3.1 Flash Lite (via CLI)</option>
                  <option value="google-gemini-cli/gemini-3-flash-preview">Gemini 3 Flash (via CLI)</option>
                </>
              )}
            </select>
          </div>
        </div>

        {/* Dynamic Inputs */}
        <div className="bg-surface-2/20 border border-border rounded-3xl p-8 space-y-6">
          {mode === 'api_key' ? (
            <div className="space-y-6 animate-in slide-in-from-right-4 duration-500">
              <div className="space-y-2">
                <h4 className="font-bold text-lg">API Key Configuration</h4>
                <p className="text-sm text-muted-foreground">Enter your key from Google AI Studio.</p>
              </div>
              
              <div className="space-y-3">
                <label className="text-xs font-bold uppercase text-muted-foreground ml-1">API Key</label>
                <div className="relative">
                  <input
                    type="password"
                    placeholder={config?.apiKeyMasked || 'Enter your API key...'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="w-full bg-surface border-2 border-border rounded-2xl px-5 py-4 focus:border-primary outline-none transition-all pr-12 font-mono"
                  />
                  <Key className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground opacity-50" />
                </div>
                {config?.hasApiKey && !apiKey && (
                  <p className="text-[10px] text-emerald-500 font-bold uppercase tracking-widest ml-1">✓ CURRENTLY CONFIGURED ({config.apiKeyMasked})</p>
                )}
              </div>
              
              <div className="p-4 bg-primary/5 rounded-2xl border border-primary/10">
                <div className="flex gap-3 text-xs text-primary font-medium leading-relaxed">
                  <ExternalLink className="w-4 h-4 shrink-0" />
                  <span>Your key is stored securely in the <code>.env</code> file of your OpenClaw instance.</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-6 animate-in slide-in-from-right-4 duration-500">
              <div className="space-y-2">
                <h4 className="font-bold text-lg text-primary">Headless OAuth Procedure</h4>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  OAuth requires a manual terminal step on your VPS because the server is headless.
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex items-start gap-3 p-4 bg-surface rounded-2xl border border-border shadow-sm">
                  <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-black shrink-0">1</div>
                  <div className="text-xs leading-relaxed">
                    Save these settings and <strong>Restart the Gateway</strong> from the VPS terminal.
                  </div>
                </div>
                <div className="flex items-start gap-3 p-4 bg-surface rounded-2xl border border-border shadow-sm">
                  <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-black shrink-0">2</div>
                  <div className="text-xs leading-relaxed">
                    SSH into your VPS and run the login command:
                    <div className="mt-2 p-2 bg-background rounded-lg font-mono text-[10px] border border-border overflow-x-auto whitespace-nowrap">
                      docker exec -it aimindmesh-openclaw-gateway node dist/index.js models auth login --provider google-gemini-cli --set-default
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-4 bg-surface rounded-2xl border border-border shadow-sm">
                  <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-black shrink-0">3</div>
                  <div className="text-xs leading-relaxed">
                    Open the printed URL in your <strong>local browser</strong> and authorize access.
                  </div>
                </div>
              </div>

              <p className="text-[10px] text-muted-foreground italic text-center">
                This process links your Google One / AI Pro subscription tokens to OpenClaw.
              </p>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/20 p-4 rounded-2xl text-destructive text-sm font-bold flex items-center gap-3">
          <AlertTriangle className="w-5 h-5" />
          {error}
        </div>
      )}

      {/* Action Footer */}
      <div className="pt-6 border-t border-border flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-primary hover:bg-primary-hover text-white px-10 py-4 rounded-full font-bold flex items-center gap-3 transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:scale-100 shadow-lg shadow-primary/20"
        >
          {saving ? <RefreshCcw className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>
    </div>
  );
};
