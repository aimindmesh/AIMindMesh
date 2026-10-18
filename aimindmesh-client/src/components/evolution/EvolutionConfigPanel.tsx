import { Activity, ShieldCheck } from 'lucide-react';
import { Dropdown } from '../ui/Dropdown';

interface EvolutionConfigPanelProps {
  serverConfig: any;
  localNodes: any[];
  isSavingConfig: boolean;
  handleUpdateConfig: (partial: any) => void;
}

/** Global parameters of the auto-evolution engine (the `autoEvolution` section of the server config). */
export function EvolutionConfigPanel({ serverConfig, localNodes, isSavingConfig, handleUpdateConfig }: EvolutionConfigPanelProps) {
  return (
    <div className="glass-panel p-8 rounded-[40px] flex flex-col gap-8 border-white/5">
      <h3 className="text-[11px] font-black uppercase tracking-[0.4em] text-primary flex items-center gap-4">
        <ShieldCheck size={18} /> Global Parameters
      </h3>

      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xs font-black uppercase tracking-widest opacity-60">Engine Status</span>
            {isSavingConfig && <Activity size={12} className="text-primary animate-spin" />}
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input 
              type="checkbox" 
              checked={serverConfig?.autoEvolution?.enabled || false} 
              onChange={(e) => handleUpdateConfig({ autoEvolution: { ...serverConfig?.autoEvolution, enabled: e.target.checked } })}
              className="sr-only peer" 
            />
            <div className="w-11 h-6 bg-surface peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
          </label>
        </div>

        <div className="flex flex-col gap-3">
          <span className="text-xs font-black uppercase tracking-widest opacity-60">Preferred Node</span>
          <Dropdown 
            value={serverConfig?.autoEvolution?.preferredNode || 'AUTO'}
            onChange={(val) => handleUpdateConfig({ autoEvolution: { ...serverConfig?.autoEvolution, preferredNode: val } })}
            options={[
              { label: 'AUTOMATIC ROUTING', value: 'AUTO' },
              { 
                label: 'CLOUD PROVIDERS', 
                options: [
                  { label: 'GOOGLE GEMINI', value: 'GEMINI' },
                  { label: 'OPENROUTER', value: 'OPENROUTER' },
                  { label: 'FREELLMAPI', value: 'FREELLMAPI' }
                ]
              },
              {
                label: 'LOCAL NODES',
                options: localNodes.map((n: any) => ({
                  label: `${n.id.toUpperCase()} (${n.type.toUpperCase()})`,
                  value: n.id
                }))
              }
            ]}
            className="w-full font-black text-xs"
          />
        </div>

        <div className="flex flex-col gap-3">
          <span className="text-xs font-black uppercase tracking-widest opacity-60">Daily Proposal Limit</span>
          <input 
            type="number"
            value={serverConfig?.autoEvolution?.maxProposalsPerDay || 3}
            onChange={(e) => handleUpdateConfig({ autoEvolution: { ...serverConfig?.autoEvolution, maxProposalsPerDay: parseInt(e.target.value) } })}
            className="w-full bg-surface border border-border rounded-2xl p-4 text-xs font-black focus:border-primary/50 outline-none"
          />
        </div>

        <div className="flex flex-col gap-3">
          <span className="text-xs font-black uppercase tracking-widest opacity-60">Cron Expression</span>
          <input 
            type="text"
            value={serverConfig?.autoEvolution?.cronExpression || '0 3 * * *'}
            onChange={(e) => handleUpdateConfig({ autoEvolution: { ...serverConfig?.autoEvolution, cronExpression: e.target.value } })}
            className="w-full bg-surface border border-border rounded-2xl p-4 text-xs font-mono focus:border-primary/50 outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-3">
            <span className="text-xs font-black uppercase tracking-widest opacity-60">Min Severity</span>
            <input 
              type="number"
              min="1"
              max="10"
              value={serverConfig?.autoEvolution?.minSeverityThreshold || 6}
              onChange={(e) => handleUpdateConfig({ autoEvolution: { ...serverConfig?.autoEvolution, minSeverityThreshold: parseInt(e.target.value) } })}
              className="w-full bg-surface border border-border rounded-2xl p-4 text-xs font-black focus:border-primary/50 outline-none"
            />
          </div>
          <div className="flex flex-col gap-3">
            <span className="text-xs font-black uppercase tracking-widest opacity-60">Min Confidence</span>
            <input 
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={serverConfig?.autoEvolution?.minConfidenceThreshold || 0.65}
              onChange={(e) => handleUpdateConfig({ autoEvolution: { ...serverConfig?.autoEvolution, minConfidenceThreshold: parseFloat(e.target.value) } })}
              className="w-full bg-surface border border-border rounded-2xl p-4 text-xs font-black focus:border-primary/50 outline-none"
            />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <span className="text-xs font-black uppercase tracking-widest opacity-60">Validation Timeout (ms)</span>
          <input 
            type="number"
            value={serverConfig?.autoEvolution?.validationTimeoutMs || 60000}
            onChange={(e) => handleUpdateConfig({ autoEvolution: { ...serverConfig?.autoEvolution, validationTimeoutMs: parseInt(e.target.value) } })}
            className="w-full bg-surface border border-border rounded-2xl p-4 text-xs font-black focus:border-primary/50 outline-none"
          />
        </div>

        <div className="flex flex-col gap-3">
           <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-widest opacity-60">Shadow Mode</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={serverConfig?.autoEvolution?.shadowMode || false} 
                  onChange={(e) => handleUpdateConfig({ autoEvolution: { ...serverConfig?.autoEvolution, shadowMode: e.target.checked } })}
                  className="sr-only peer" 
                />
                <div className="w-11 h-6 bg-surface peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
              </label>
           </div>
           <p className="text-[10px] text-muted-foreground italic">If enabled, the engine only validates code without pushing to Gitea.</p>
        </div>
      </div>
    </div>
  );
}
