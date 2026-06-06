import React, { useEffect, useState } from 'react';
import { agentApi } from '../../services/serverApi';
import { useHermesStore } from '../../store/hermesStore';

type ConfigFileType = 'yaml' | 'env';

export const HermesConfigEditor: React.FC = () => {
  const { setConfig } = useHermesStore();
  const [activeFile, setActiveFile] = useState<ConfigFileType>('yaml');
  const [yamlDraft, setYamlDraft] = useState('');
  const [envDraft, setEnvDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const { data } = await agentApi.getHermesConfig();
      setConfig(data.configYaml, data.envFile);
      setYamlDraft(data.configYaml);
      setEnvDraft(data.envFile);
    } catch (e) {
      console.error('Failed to fetch Hermes config', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await agentApi.saveHermesConfig(yamlDraft, envDraft);
      setConfig(yamlDraft, envDraft);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error('Failed to save Hermes config', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 h-full animate-in zoom-in-95 duration-500">
      <div className="flex justify-between items-end border-b border-border pb-4">
        <div>
          <h3 className="text-xl font-bold tracking-tight">Hermes Config Editor</h3>
          <p className="text-sm text-muted-foreground mt-1">Configure Hermes tools, system instructions, and service credentials.</p>
        </div>
        <button
          onClick={fetchConfig}
          disabled={loading}
          className="p-2 rounded-xl bg-surface-2 border border-border hover:bg-surface-offset transition-all text-muted-foreground hover:text-foreground disabled:opacity-50"
          title="Reload configuration"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 flex-1">
        {/* Navigation */}
        <div className="flex flex-col gap-2">
          <button
            onClick={() => setActiveFile('yaml')}
            className={`text-left rounded-xl p-4 border transition-all duration-300 flex flex-col gap-1 ${
              activeFile === 'yaml'
                ? 'bg-purple-600 border-purple-600 shadow-lg shadow-purple-600/10 text-white'
                : 'bg-surface border-border hover:bg-surface-offset'
            }`}
          >
            <div className="font-bold text-sm tracking-wide font-mono uppercase">config.yaml</div>
            <div className={`text-[10px] leading-relaxed opacity-70 ${activeFile === 'yaml' ? 'text-purple-200' : 'text-muted-foreground'}`}>
              Hermes core properties, active agent personalities, and tools configurations.
            </div>
          </button>

          <button
            onClick={() => setActiveFile('env')}
            className={`text-left rounded-xl p-4 border transition-all duration-300 flex flex-col gap-1 ${
              activeFile === 'env'
                ? 'bg-purple-600 border-purple-600 shadow-lg shadow-purple-600/10 text-white'
                : 'bg-surface border-border hover:bg-surface-offset'
            }`}
          >
            <div className="font-bold text-sm tracking-wide font-mono uppercase">.env</div>
            <div className={`text-[10px] leading-relaxed opacity-70 ${activeFile === 'env' ? 'text-purple-200' : 'text-muted-foreground'}`}>
              API keys, tokens, endpoints, and credentials for integrated tools and platforms.
            </div>
          </button>

          <div className="mt-auto p-4 bg-purple-500/10 border border-purple-500/20 rounded-xl">
            <p className="text-[10px] text-purple-400 font-bold uppercase tracking-widest leading-relaxed">
              ⚠️ Restart Required: Credential updates in `.env` may require container restart to take full effect.
            </p>
          </div>
        </div>

        {/* Editor */}
        <div className="lg:col-span-3 flex flex-col gap-4">
          {loading ? (
            <div className="flex-1 flex items-center justify-center bg-surface border border-border rounded-2xl min-h-[400px]">
              <span className="text-xs text-muted-foreground animate-pulse">Loading files content...</span>
            </div>
          ) : (
            <textarea
              value={activeFile === 'yaml' ? yamlDraft : envDraft}
              onChange={(e) => {
                if (activeFile === 'yaml') {
                  setYamlDraft(e.target.value);
                } else {
                  setEnvDraft(e.target.value);
                }
              }}
              className="flex-1 rounded-2xl p-6 font-mono text-sm leading-relaxed bg-surface border border-border focus:ring-2 focus:ring-purple-500/20 outline-none shadow-inner resize-none min-h-[400px]"
              spellCheck={false}
            />
          )}

          <div className="flex justify-end items-center gap-4">
            <button
              onClick={save}
              disabled={saving || loading}
              className={`rounded-xl px-8 py-3 text-sm font-bold tracking-widest uppercase transition-all shadow-lg ${
                saved
                  ? 'bg-success text-success-foreground'
                  : 'bg-purple-600 text-white hover:shadow-purple-600/30 active:scale-95'
              } disabled:opacity-50`}
            >
              {saving ? 'SAVING...' : saved ? '✓ SAVED' : 'SAVE CHANGES'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
