import React, { useEffect, useState } from 'react';
import { agentApi } from '../../services/serverApi';
import { useOpenClawStore } from '../../store/openclawStore';

type ConfigFilename = 'soul' | 'identity' | 'agents' | 'memory';

const FILES: { key: ConfigFilename; label: string; description: string }[] = [
  { key: 'soul', label: 'Soul.md', description: "Agent name, personality, and communication style" },
  { key: 'identity', label: 'Identity.md', description: "System context, capabilities, and environment facts" },
  { key: 'agents', label: 'Agents.md', description: "Red lines, allowed actions, and security rules" },
  { key: 'memory', label: 'Memory.md', description: "Persistent facts, preferences, and recurring tasks" },
];

export const SoulEditor: React.FC = () => {
  const { setConfigFile } = useOpenClawStore();
  const [active, setActive] = useState<ConfigFilename>('soul');
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const { data } = await agentApi.getConfigFile(active);
        setConfigFile(active, data.content);
        setDraft(data.content);
      } catch (e) {
        console.error('Failed to fetch config', e);
        setDraft('# Error loading configuration file.');
      }
    };
    
    fetchConfig();
  }, [active, setConfigFile]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await agentApi.saveConfigFile(active, draft);
      setConfigFile(active, draft);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error('Failed to save config', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 h-full animate-in zoom-in-95 duration-500">
      <div className="flex justify-between items-end border-b border-border pb-4">
        <div>
          <h3 className="text-xl font-bold tracking-tight">Agent Configuration</h3>
          <p className="text-sm text-muted-foreground mt-1">Refine the sidecar's identity, permissions, and session memory.</p>
        </div>
        <button 
            onClick={() => setActive(prev => prev)} // Trigger useEffect
            className="p-2 rounded-xl bg-surface-2 border border-border hover:bg-surface-offset transition-all text-muted-foreground hover:text-foreground"
            title="Reload from source"
        >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 flex-1">
        {/* Navigation */}
        <div className="flex flex-col gap-2">
          {FILES.map((f) => (
            <button
              key={f.key}
              onClick={() => setActive(f.key)}
              className={`text-left rounded-xl p-4 border transition-all duration-300 flex flex-col gap-1 ${
                active === f.key 
                ? 'bg-primary border-primary shadow-lg shadow-primary/10 text-primary-foreground' 
                : 'bg-surface border-border hover:bg-surface-offset'
              }`}
            >
              <div className="font-bold text-sm tracking-wide font-mono uppercase">{f.label}</div>
              <div className={`text-[10px] leading-relaxed opacity-70 ${active === f.key ? 'text-primary-foreground' : 'text-muted-foreground'}`}>{f.description}</div>
            </button>
          ))}
          <div className="mt-auto p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
             <p className="text-[10px] text-amber-500 font-bold uppercase tracking-widest leading-relaxed">
               ⚠️ Hot Reload: Changes take effect immediately upon saving.
             </p>
          </div>
        </div>

        {/* Editor */}
        <div className="lg:col-span-3 flex flex-col gap-4">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="flex-1 rounded-2xl p-6 font-mono text-sm leading-relaxed bg-surface border border-border focus:ring-2 focus:ring-primary/20 outline-none shadow-inner resize-none min-h-[400px]"
            spellCheck={false}
          />

          <div className="flex justify-end items-center gap-4">
            <button
              onClick={save}
              disabled={saving}
              className={`rounded-xl px-8 py-3 text-sm font-bold tracking-widest uppercase transition-all shadow-lg ${
                saved 
                ? 'bg-success text-success-foreground' 
                : 'bg-primary text-primary-foreground hover:shadow-primary/30 active:scale-95'
              } disabled:opacity-50`}
            >
              {saving ? 'SAVING...' : saved ? '✓ SAVED' : 'COMMIT CHANGES'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
