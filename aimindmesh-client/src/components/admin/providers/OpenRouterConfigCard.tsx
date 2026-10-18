import { Globe, Key, RefreshCw } from 'lucide-react';
import { Dropdown } from '../../ui/Dropdown';

interface OpenRouterConfigCardProps {
  config: any;
  onUpdateConfig: (partial: any) => void;
  openRouterModels: any[];
  onRefresh: () => void;
  isLoading: boolean;
}

/** OpenRouter settings: key, model, daily cap and the credit checks. */
export function OpenRouterConfigCard({ config, onUpdateConfig, openRouterModels, onRefresh, isLoading }: OpenRouterConfigCardProps) {
  return (
    <div className="glass-panel p-8 rounded-[48px] border-secondary/10 flex flex-col gap-8 group/cfg relative min-h-[420px]">
       <div className="flex items-center gap-4">
          <div className="p-4 bg-secondary/10 rounded-3xl text-secondary shadow-lg shadow-secondary/5 group-hover/cfg:scale-110 transition-transform">
             <Globe size={24} />
          </div>
          <div>
             <h4 className="font-black text-lg tracking-tight uppercase italic underline decoration-secondary/40 decoration-4 underline-offset-8">Universal Model Bridge</h4>
             <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest mt-2 opacity-60 italic">OpenRouter Provisioning & Analytical Selection</p>
          </div>
       </div>

       <div className="grid grid-cols-1 gap-6">
          <div className="space-y-3">
             <label className="text-[11px] font-black text-muted-foreground uppercase tracking-widest ml-1 italic flex items-center gap-2">
                <Key size={12} className="text-secondary" /> OpenRouter Auth Token
             </label>
             <input 
                type="password"
                placeholder="sk-or-v1-••••••••••••"
                value={config?.openrouter?.apiKey || ''}
                onChange={(e) => onUpdateConfig({ openrouter: { ...config?.openrouter, apiKey: e.target.value } })}
                className="w-full bg-surface border border-border rounded-2xl p-4 outline-none focus:border-secondary font-mono font-black text-sm shadow-inner transition-all hover:border-secondary/40"
             />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
             <div className="space-y-3">
                <label className="text-[11px] font-black text-muted-foreground uppercase tracking-widest ml-1 italic">Analytical Target</label>
                <div className="flex gap-2">
                   <div className="flex-1">
                      {openRouterModels.length > 0 ? (
                         <Dropdown 
                            value={config?.openrouter?.model || ''}
                            onChange={(val) => onUpdateConfig({ openrouter: { ...config?.openrouter, model: val } })}
                            options={Object.entries(
                              openRouterModels.reduce((acc: any, m: any) => {
                                const provider = m.id.split('/')[0];
                                if (!acc[provider]) acc[provider] = [];
                                acc[provider].push({ label: m.name.toUpperCase(), value: m.id });
                                return acc;
                              }, {})
                            ).sort().map(([provider, options]: [string, any]) => ({
                              label: provider.toUpperCase(),
                              options: options.sort((a: any, b: any) => a.label.localeCompare(b.label))
                            }))}
                            className="font-mono font-black"
                         />
                      ) : (
                         <input 
                            type="text"
                            placeholder="anthropic/claude-3.5-sonnet"
                            value={config?.openrouter?.model || ''}
                            onChange={(e) => onUpdateConfig({ openrouter: { ...config?.openrouter, model: e.target.value } })}
                            className="w-full bg-surface border border-border rounded-2xl p-4 outline-none focus:border-secondary font-mono font-black text-sm shadow-inner transition-all hover:border-secondary/40"
                         />
                      )}
                   </div>
                   <button 
                     onClick={onRefresh}
                     className="px-4 bg-surface border border-border rounded-2xl hover:bg-surface-hover hover:border-secondary/40 transition-all text-secondary shadow-inner active:scale-95"
                     title="Reload OpenRouter Models"
                   >
                     <RefreshCw size={18} className={isLoading ? 'animate-spin' : ''} />
                   </button>
                </div>
             </div>
             <div className="space-y-3">
                <label className="text-[11px] font-black text-muted-foreground uppercase tracking-widest ml-1 italic">Daily Quota Limit</label>
                <input 
                   type="number"
                   value={config?.openrouter?.dailyQuotaCap || 100}
                   onChange={(e) => onUpdateConfig({ openrouter: { ...config?.openrouter, dailyQuotaCap: parseInt(e.target.value) } })}
                   className="w-full bg-surface border border-border rounded-2xl p-4 outline-none focus:border-secondary font-mono font-black text-sm shadow-inner transition-all hover:border-secondary/40"
                />
             </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
             <div className="space-y-3">
                <label className="text-[11px] font-black text-muted-foreground uppercase tracking-widest ml-1 italic">Credit Check Interval (h)</label>
                <input 
                   type="number"
                   value={config?.openrouter?.creditCheckIntervalHours || 1}
                   onChange={(e) => onUpdateConfig({ openrouter: { ...config?.openrouter, creditCheckIntervalHours: parseInt(e.target.value) } })}
                   className="w-full bg-surface border border-border rounded-2xl p-4 outline-none focus:border-secondary font-mono font-black text-sm shadow-inner transition-all hover:border-secondary/40"
                />
             </div>
             <div className="space-y-3">
                <label className="text-[11px] font-black text-muted-foreground uppercase tracking-widest ml-1 italic">Low Credit Alert ($)</label>
                <input 
                   type="number"
                   step="0.5"
                   value={config?.openrouter?.lowCreditThreshold || 5}
                   onChange={(e) => onUpdateConfig({ openrouter: { ...config?.openrouter, lowCreditThreshold: parseFloat(e.target.value) } })}
                   className="w-full bg-surface border border-border rounded-2xl p-4 outline-none focus:border-secondary font-mono font-black text-sm shadow-inner transition-all hover:border-secondary/40"
                />
             </div>
          </div>
       </div>
    </div>
  );
}
