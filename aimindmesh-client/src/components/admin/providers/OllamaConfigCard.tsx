import { Database, RefreshCw } from 'lucide-react';
import { Dropdown } from '../../ui/Dropdown';
import type { AdminServerStatus } from '../../../types/adminStatus';

interface OllamaConfigCardProps {
  status: AdminServerStatus | null;
  config: any;
  onUpdateConfig: (partial: any) => void;
  availableModels: string[];
  onRefreshNodes: () => void;
  isLoading: boolean;
}

/** Server Ollama settings: URL, default and embedding models, threads, context, keep-alive. */
export function OllamaConfigCard({ status, config, onUpdateConfig, availableModels, onRefreshNodes, isLoading }: OllamaConfigCardProps) {
  return (
    <div className="glass-panel p-8 rounded-[48px] border-warning/10 flex flex-col gap-8 group/cfg bg-[#070a14]/[0.4]">
       <div className="flex items-center gap-4">
          <div className="p-4 bg-warning/10 rounded-3xl text-warning shadow-lg shadow-warning/5 group-hover/cfg:scale-110 transition-transform">
             <Database size={24} />
          </div>
          <div>
             <h4 className="font-black text-lg tracking-tight uppercase italic underline decoration-warning/40 decoration-4 underline-offset-8">Server Neural Engine</h4>
             <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest mt-2 opacity-60 italic">Ollama Cluster Topology & Inference Defaults</p>
          </div>
       </div>

       <div className="grid grid-cols-1 gap-6">
          <div className="space-y-3">
             <label className="text-[11px] font-black text-muted-foreground uppercase tracking-widest ml-1 italic">Vulkan Engine Endpoint</label>
             <input 
                type="text"
                placeholder="http://10.2.0.1:11434"
                value={config?.ollama?.baseUrl || ''}
                onChange={(e) => onUpdateConfig({ ollama: { ...config?.ollama, baseUrl: e.target.value } })}
                className="w-full bg-surface border border-border rounded-2xl p-4 outline-none focus:border-warning font-mono font-black text-sm shadow-inner transition-all hover:border-warning/40"
             />
          </div>

          <div className="space-y-3">
             <label className="text-[11px] font-black text-muted-foreground uppercase tracking-widest ml-1 italic">Default Inference Model</label>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  {availableModels.length > 0 ? (
                     <Dropdown 
                        value={config?.ollama?.defaultModel || ''}
                        onChange={(val) => onUpdateConfig({ ollama: { ...config?.ollama, defaultModel: val } })}
                        options={availableModels.map(m => ({ label: m.toUpperCase(), value: m }))}
                        className="font-mono font-black"
                     />
                  ) : (
                     <input 
                        type="text"
                        placeholder="qwen2.5:7b-instruct"
                        value={config?.ollama?.defaultModel || ''}
                        onChange={(e) => onUpdateConfig({ ollama: { ...config?.ollama, defaultModel: e.target.value } })}
                        className="w-full bg-surface border border-border rounded-2xl p-4 outline-none focus:border-warning font-mono font-black text-sm shadow-inner"
                     />
                  )}
                </div>
                <button 
                  onClick={onRefreshNodes}
                  className="px-4 bg-surface border border-border rounded-2xl hover:bg-surface-hover hover:border-warning/40 transition-all text-warning shadow-inner active:scale-95"
                  title="Reload Model List"
                >
                  <RefreshCw size={18} className={isLoading ? 'animate-spin' : ''} />
                </button>
              </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-2">
             <div className="space-y-3">
                <label className="text-[11px] font-black text-muted-foreground uppercase tracking-widest ml-1 italic">Request Timeout (MIN)</label>
                <input 
                   type="number"
                   value={Math.floor((config?.ollama?.timeoutMs || 1800000) / 60000)}
                   onChange={(e) => onUpdateConfig({ ollama: { ...config?.ollama, timeoutMs: parseInt(e.target.value) * 60000 } })}
                   className="w-full bg-surface border border-border rounded-2xl p-4 outline-none focus:border-warning font-mono font-black text-sm shadow-inner transition-all hover:border-warning/40"
                />
             </div>
             <div className="space-y-3">
                <label className="text-[11px] font-black text-muted-foreground uppercase tracking-widest ml-1 italic">Execution Threads</label>
                <input 
                   type="number"
                   min={1}
                   max={status?.coreCount || 4}
                   value={config?.ollama?.numThread || status?.coreCount || 4}
                   onChange={(e) => onUpdateConfig({ ollama: { ...config?.ollama, numThread: Math.min(parseInt(e.target.value), status?.coreCount || 99) } })}
                   className="w-full bg-surface border border-border rounded-2xl p-4 outline-none focus:border-warning font-mono font-black text-sm shadow-inner transition-all hover:border-warning/40"
                />
             </div>
             <div className="space-y-3">
                <label className="text-[11px] font-black text-muted-foreground uppercase tracking-widest ml-1 italic">Context Window</label>
                <input 
                   type="number"
                   value={config?.ollama?.numCtx || 4096}
                   onChange={(e) => onUpdateConfig({ ollama: { ...config?.ollama, numCtx: parseInt(e.target.value) } })}
                   className="w-full bg-surface border border-border rounded-2xl p-4 outline-none focus:border-warning font-mono font-black text-sm shadow-inner transition-all hover:border-warning/40"
                />
             </div>
          </div>
       </div>
    </div>
  );
}
