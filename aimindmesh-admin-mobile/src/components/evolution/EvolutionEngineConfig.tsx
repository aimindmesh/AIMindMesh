import { ChevronRight, Clock, RefreshCw, Save } from 'lucide-react';
import type { SelectorGroup } from '../ui/CategorizedSelector';
import type { SelectorConfig } from './evolutionShared';

interface EvolutionEngineConfigProps {
  localConfig: any;
  setLocalConfig: (config: any) => void;
  nodes: any[];
  isSavingConfig: boolean;
  handleSaveConfig: () => void;
  setSelectorConfig: (config: SelectorConfig | null) => void;
  setIsSelectorOpen: (open: boolean) => void;
}

/** Auto-evolution engine settings (edited locally, saved with the button). */
export function EvolutionEngineConfig({ localConfig, setLocalConfig, nodes, isSavingConfig, handleSaveConfig, setSelectorConfig, setIsSelectorOpen }: EvolutionEngineConfigProps) {
  return (
    <div className="flex flex-col gap-4 pb-4">
      <div className="glass-panel p-5 rounded-3xl border border-white/5 flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-black uppercase tracking-widest text-primary">Engine Control</h3>
            <p className="text-[9px] text-muted-foreground italic">Autonomous status</p>
          </div>
          <button
            onClick={() => setLocalConfig({ ...localConfig, enabled: !localConfig.enabled })}
            className={`w-12 h-6 rounded-full p-1 transition-all ${localConfig.enabled ? 'bg-primary' : 'bg-surface border border-border'}`}
          >
            <div className={`w-4 h-4 bg-white rounded-full transition-all ${localConfig.enabled ? 'translate-x-6' : 'translate-x-0'}`} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1 block">Preferred Routing</label>
            <button
              onClick={() => {
                const groups: SelectorGroup[] = [
                  {
                    label: 'System',
                    options: [{ label: 'AUTOMATIC', value: 'AUTO', description: 'Dynamic allocation' }]
                  },
                  {
                    label: 'Available Nodes',
                    options: nodes.map(n => ({ 
                      label: n.id === 'SERVER_LOCAL' ? 'OLLAMA' : (n.type === 'pc_client' || n.id === 'LAPTOP') ? 'LAPTOP' : n.id.toUpperCase(), 
                      value: n.id, 
                      description: n.url 
                    }))
                  },
                  {
                    label: 'Cloud Fallback',
                    options: [
                      { label: 'GEMINI', value: 'GEMINI_API', description: 'Google AI' },
                      { label: 'OPENROUTER', value: 'OPENROUTER_API', description: 'Multi-provider' },
                      { label: 'FREELLMAPI', value: 'FREELLMAPI', description: 'FreeLLMAPI Gateway' }
                    ]
                  }
                ];
                setSelectorConfig({
                  title: 'Select Preferred Node',
                  groups,
                  currentValue: localConfig.preferredNode || 'AUTO',
                  onSelect: (v) => setLocalConfig({ ...localConfig, preferredNode: v })
                });
                setIsSelectorOpen(true);
              }}
              className="w-full bg-surface border border-border rounded-xl p-4 flex items-center justify-between group active:scale-[0.98] transition-all"
            >
              <span className="text-[11px] font-black uppercase tracking-widest">{localConfig.preferredNode || 'AUTO'}</span>
              <ChevronRight size={14} className="text-muted-foreground opacity-30 group-hover:opacity-100" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1 block">Daily PR Limit</label>
              <input
                type="number"
                value={localConfig.maxProposalsPerDay || 3}
                onChange={e => setLocalConfig({ ...localConfig, maxProposalsPerDay: parseInt(e.target.value) })}
                className="w-full bg-surface border border-border rounded-xl p-3 text-xs font-black outline-none focus:border-primary/50"
              />
            </div>
            <div>
              <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1 block">Min Severity</label>
              <input
                type="number"
                min="1" max="10"
                value={localConfig.minSeverityThreshold || 6}
                onChange={e => setLocalConfig({ ...localConfig, minSeverityThreshold: parseInt(e.target.value) })}
                className="w-full bg-surface border border-border rounded-xl p-3 text-xs font-black outline-none focus:border-primary/50"
              />
            </div>
          </div>

          <div>
            <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1 block">Cron Schedule</label>
            <div className="flex items-center gap-2 bg-surface border border-border rounded-xl p-3">
              <Clock size={12} className="text-muted-foreground" />
              <input
                type="text"
                value={localConfig.cronExpression || '0 3 * * *'}
                onChange={e => setLocalConfig({ ...localConfig, cronExpression: e.target.value })}
                className="flex-1 bg-transparent text-xs font-mono outline-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-between p-3 bg-surface/50 rounded-2xl border border-border/30">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest">Shadow Mode</p>
              <p className="text-[8px] text-muted-foreground italic">Validate without merging</p>
            </div>
            <button
              onClick={() => setLocalConfig({ ...localConfig, shadowMode: !localConfig.shadowMode })}
              className={`w-10 h-5 rounded-full p-1 transition-all ${localConfig.shadowMode ? 'bg-warning' : 'bg-surface border border-border'}`}
            >
              <div className={`w-3 h-3 bg-white rounded-full transition-all ${localConfig.shadowMode ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>

        <button
          onClick={handleSaveConfig}
          disabled={isSavingConfig}
          className="btn-primary w-full py-4 mt-2"
        >
          {isSavingConfig ? <RefreshCw className="animate-spin" size={14} /> : <Save size={14} />}
          {isSavingConfig ? 'Saving...' : 'Save Engine Config'}
        </button>
      </div>
    </div>
  );
}
