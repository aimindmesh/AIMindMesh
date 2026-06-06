import { Cpu, Activity, HardDrive, RefreshCw, Layers, Zap, Clock, Globe, Shield, Terminal, Key, Database, Cloud } from 'lucide-react';
import { Dropdown } from '../ui/Dropdown';
import { TaskPriorityManager } from './TaskPriorityManager';
import { TaskStatsDashboard } from './TaskStatsDashboard';

interface Node {
  id: string;
  type: string;
  url: string;
  status: string;
  version?: string;
  address?: string;
  last_heartbeat?: number;
  capabilities?: string[];
  name?: string;
}

interface AdminOverviewProps {
  status: {
    cpu: number;
    ram: { total: string; used: string; percent: number };
    nodes: Node[];
    geminiUsage: number;
    openrouterUsage: number;
    dailyQuotaCap?: number;
    openrouterDailyQuotaCap?: number;
    coreCount?: number;
    openrouterCredits?: {
      balance: number;
      total_usage: number;
      total_credits: number;
      lastChecked: number;
    } | null;
    infrastructureBrake: boolean;
    openClawHealth?: {
      isHealthy: boolean;
      statusMessage: string;
      lastCheck: number;
    };
  } | null;
  config: any;
  onUpdateConfig: (partial: any) => void;
  onToggleBrake: (active: boolean) => void;
  availableModels: string[];
  openRouterModels?: any[];
  onRefresh: () => void;
  onPrune: () => void;
  onRefreshNodes: () => void;
  isLoading: boolean;
}

export function AdminOverview({ status, config, onUpdateConfig, onToggleBrake, availableModels, openRouterModels = [], onRefresh, onPrune, onRefreshNodes, isLoading }: AdminOverviewProps) {
  const geminiPercent = status?.dailyQuotaCap ? (status.geminiUsage / status.dailyQuotaCap) * 100 : 0;
  
  const orCredits = status?.openrouterCredits;
  const openrouterPercent = (orCredits && orCredits.total_credits > 0) 
    ? (orCredits.total_usage / orCredits.total_credits) * 100 
    : 0;

  return (
    <div className="flex flex-col gap-12 animate-in fade-in slide-in-from-bottom-6 duration-700">
      
      <TaskStatsDashboard />

      {/* Dashboard Top Layer */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
        
        {/* Computing Resources */}
        <div className="glass-panel p-8 rounded-[40px] flex flex-col justify-between group overflow-hidden relative border-primary/10">
          <div className="absolute top-0 right-0 p-8 opacity-[0.03] group-hover:opacity-[0.1] transition-all duration-700">
            <Cpu size={140} />
          </div>
          <div className="flex items-center justify-between mb-6 relative z-10">
            <div className="p-4 bg-primary/10 rounded-3xl text-primary shadow-lg shadow-primary/5">
              <Layers size={24} />
            </div>
            <button onClick={onRefresh} className="p-2.5 hover:bg-surface-hover rounded-2xl transition-all active:scale-90" title="Synchronize Telemetry">
               <RefreshCw size={18} className={isLoading ? 'animate-spin text-primary' : 'text-muted-foreground opacity-50'} />
            </button>
          </div>
          <div className="relative z-10">
            <h3 className="text-muted-foreground text-[11px] font-black uppercase tracking-[0.2em] mb-2 italic">Infrastructure Core</h3>
            <p className="text-3xl font-black tracking-tighter italic">SERVER CLOUD A1 <span className="text-xs font-bold text-primary ml-2 uppercase tracking-widest opacity-60">aarch64</span></p>
            <div className="mt-8 space-y-6">
               <div className="space-y-2">
                  <div className="flex justify-between text-[11px] items-center">
                    <span className="font-black flex items-center gap-2"><Cpu size={14} className="text-primary" /> CPU LOAD</span>
                    <span className="font-mono font-black">{status?.cpu || 0}%</span>
                  </div>
                  <div className="h-2 bg-surface rounded-full overflow-hidden border border-border/40 shadow-inner">
                    <div className="h-full bg-primary transition-all duration-1000 shadow-[0_0_12px_rgba(79,143,247,0.5)]" style={{ width: `${status?.cpu || 0}%` }} />
                  </div>
               </div>
               <div className="space-y-2">
                  <div className="flex justify-between text-[11px] items-center">
                    <span className="font-black flex items-center gap-2"><HardDrive size={14} className="text-success" /> RAM ALLOCATION</span>
                    <span className="font-mono font-black">{status?.ram.percent || 0}% <span className="opacity-40 ml-2">({status?.ram.used} / {status?.ram.total})</span></span>
                  </div>
                  <div className="h-2 bg-surface rounded-full overflow-hidden border border-border/40 shadow-inner">
                    <div className="h-full bg-success transition-all duration-1000 shadow-[0_0_12px_rgba(34,197,94,0.5)]" style={{ width: `${status?.ram.percent || 0}%` }} />
                  </div>
               </div>
            </div>
          </div>
        </div>

        {/* Gemini API Monitoring */}
        <div className="glass-panel p-8 rounded-[40px] flex flex-col justify-between group bg-primary/5 border-primary/20 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-[0.03] group-hover:opacity-[0.1] transition-all duration-700">
            <Zap size={140} />
          </div>
          <div className="flex items-center justify-between mb-6 relative z-10">
            <div className="p-4 bg-primary text-white rounded-3xl shadow-xl shadow-primary/30">
              <Zap size={24} fill="currentColor" />
            </div>
            <span className="px-4 py-1.5 bg-surface border border-primary/30 rounded-[14px] text-[10px] font-black text-primary uppercase tracking-[0.2em] italic">Neural Link</span>
          </div>
          <div className="relative z-10">
            <h3 className="text-muted-foreground text-[11px] font-black uppercase tracking-[0.2em] mb-2 italic">Flash Usage (DAILY)</h3>
            <p className="text-3xl font-black tracking-tighter italic uppercase">Gemini Cloud <span className="text-xs font-bold text-muted-foreground ml-2 opacity-60">Guard</span></p>
            <div className="mt-8 flex items-end gap-6 text-primary">
               <div className="relative w-24 h-24 flex items-center justify-center">
                  <svg className="w-full h-full -rotate-90 drop-shadow-lg">
                    <circle cx="48" cy="48" r="42" fill="none" stroke="currentColor" strokeWidth="10" className="opacity-10" />
                    <circle cx="48" cy="48" r="42" fill="none" stroke="currentColor" strokeWidth="10" strokeDasharray={`${2 * Math.PI * 42}`} strokeDashoffset={`${2 * Math.PI * 42 * (1 - geminiPercent / 100)}`} className="text-primary transition-all duration-[1500ms] shadow-primary" />
                  </svg>
                  <span className="absolute text-lg font-black italic tracking-tighter">{Math.round(geminiPercent)}%</span>
               </div>
               <div className="flex-1 space-y-2">
                  <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground italic mb-1">Synaptic Pulses</p>
                  <p className="text-lg font-black tracking-tight font-mono whitespace-nowrap">
                    {(status?.geminiUsage || 0).toLocaleString()} <span className="text-[11px] opacity-30">/ {(status?.dailyQuotaCap || 10000000).toLocaleString()}</span>
                  </p>
                  <div className="h-1.5 bg-surface rounded-full mt-3 w-full overflow-hidden border border-border/20 shadow-inner">
                    <div className="h-full bg-primary shadow-primary" style={{ width: `${geminiPercent}%` }} />
                  </div>
               </div>
            </div>
          </div>
        </div>
        {/* OpenRouter API Monitoring */}
        <div className="glass-panel p-8 rounded-[40px] flex flex-col justify-between group bg-secondary/5 border-secondary/20 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-[0.03] group-hover:opacity-[0.1] transition-all duration-700">
            <Globe size={140} />
          </div>
          <div className="flex items-center justify-between mb-6 relative z-10">
            <div className="p-4 bg-secondary text-primary rounded-3xl shadow-xl shadow-secondary/30">
              <Globe size={24} />
            </div>
            <span className="px-4 py-1.5 bg-surface border border-secondary/30 rounded-[14px] text-[10px] font-black text-secondary uppercase tracking-[0.2em] italic">OpenRouter Matrix</span>
          </div>
          <div className="relative z-10">
            <h3 className="text-muted-foreground text-[11px] font-black uppercase tracking-[0.2em] mb-2 italic">Analytical Pulses (DAILY)</h3>
            <p className="text-3xl font-black tracking-tighter italic uppercase">Universal <span className="text-xs font-bold text-muted-foreground ml-2 opacity-60">Fallback</span></p>
            <div className="mt-8 flex items-end gap-6 text-secondary">
               <div className="relative w-24 h-24 flex items-center justify-center">
                  <svg className="w-full h-full -rotate-90 drop-shadow-lg">
                    <circle cx="48" cy="48" r="42" fill="none" stroke="currentColor" strokeWidth="10" className="opacity-10" />
                    <circle cx="48" cy="48" r="42" fill="none" stroke="currentColor" strokeWidth="10" strokeDasharray={`${2 * Math.PI * 42}`} strokeDashoffset={`${2 * Math.PI * 42 * (1 - openrouterPercent / 100)}`} className="text-secondary transition-all duration-[1500ms] shadow-secondary" />
                  </svg>
                  <span className="absolute text-lg font-black italic tracking-tighter">{Math.round(openrouterPercent)}%</span>
               </div>
               <div className="flex-1 space-y-2">
                  <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground italic mb-1">Matrix Credits</p>
                  <p className="text-lg font-black tracking-tight font-mono whitespace-nowrap">
                    <span className="text-secondary mr-1">$</span>
                    {status?.openrouterCredits?.balance.toFixed(4) ?? '--'}
                    <span className="text-[11px] opacity-30 ml-2">/ Used: ${status?.openrouterCredits?.total_usage.toFixed(4) ?? '--'}</span>
                  </p>
                  <div className="h-1.5 bg-surface rounded-full mt-3 w-full overflow-hidden border border-border/20 shadow-inner">
                    <div className="h-full bg-secondary shadow-secondary" style={{ width: `${Math.min(100, openrouterPercent)}%` }} />
                  </div>
               </div>
            </div>
          </div>
        </div>

        {/* FreeLLMAPI API Monitoring */}
        <div className="glass-panel p-8 rounded-[40px] flex flex-col justify-between group bg-indigo-500/5 border-indigo-500/20 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-[0.03] group-hover:opacity-[0.1] transition-all duration-700">
            <Cloud size={140} />
          </div>
          <div className="flex items-center justify-between mb-6 relative z-10">
            <div className="p-4 bg-indigo-500 text-white rounded-3xl shadow-xl shadow-indigo-500/30">
              <Cloud size={24} fill="currentColor" />
            </div>
            <span className="px-4 py-1.5 bg-surface border border-indigo-500/30 rounded-[14px] text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] italic">Private Proxy Network</span>
          </div>
          <div className="relative z-10">
            <h3 className="text-muted-foreground text-[11px] font-black uppercase tracking-[0.2em] mb-2 italic">Proxy Link (STATUS)</h3>
            <p className="text-3xl font-black tracking-tighter italic uppercase">FreeLLMAPI <span className="text-xs font-bold text-muted-foreground ml-2 opacity-60">Edge</span></p>
            <div className="mt-8 flex items-center gap-6 text-indigo-400">
               <div className="flex-1 space-y-2">
                  <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground italic mb-1">State Protocol</p>
                  <p className={`text-xl font-black tracking-tight uppercase ${config?.freellmapi?.enabled ? 'text-indigo-400' : 'text-muted-foreground'}`}>
                    {config?.freellmapi?.enabled ? 'ONLINE & ACTIVE' : 'OFFLINE (STANDBY)'}
                  </p>
                  <div className="flex items-center gap-2 mt-4 text-[9px] font-black text-muted-foreground uppercase tracking-widest opacity-40">
                    <Globe size={12} />
                    {config?.freellmapi?.baseUrl || 'Unconfigured Route'}
                  </div>
               </div>
               <div className={`w-12 h-12 rounded-full flex items-center justify-center border-4 ${config?.freellmapi?.enabled ? 'border-indigo-500/20 text-indigo-400' : 'border-muted/20 text-muted-foreground'}`}>
                 <Cloud size={20} className={config?.freellmapi?.enabled ? 'animate-pulse' : ''} />
               </div>
            </div>
          </div>
        </div>
        
        {/* Server Agent (OpenClaw) Monitoring */}
        <div className={`glass-panel p-8 rounded-[40px] flex flex-col justify-between group border-2 relative overflow-hidden transition-all duration-500 ${status?.openClawHealth?.isHealthy ? 'bg-success/5 border-success/20' : 'bg-error/5 border-error/20'}`}>
          <div className="absolute top-0 right-0 p-8 opacity-[0.03] group-hover:opacity-[0.1] transition-all duration-700">
            <Shield size={140} />
          </div>
          <div className="flex items-center justify-between mb-6 relative z-10">
            <div className={`p-4 rounded-3xl shadow-xl transition-all ${status?.openClawHealth?.isHealthy ? 'bg-success text-white shadow-success/30' : 'bg-error text-white shadow-error/30'}`}>
              <Shield size={24} />
            </div>
            <span className={`px-4 py-1.5 bg-surface border rounded-[14px] text-[10px] font-black uppercase tracking-[0.2em] italic ${status?.openClawHealth?.isHealthy ? 'border-success/30 text-success' : 'border-error/30 text-error'}`}>
              Server Agent
            </span>
          </div>
          <div className="relative z-10">
            <h3 className="text-muted-foreground text-[11px] font-black uppercase tracking-[0.2em] mb-2 italic">Dedicated Agent Quota</h3>
            <p className="text-3xl font-black tracking-tighter italic uppercase">Autonomous <span className="text-xs font-bold text-muted-foreground ml-2 opacity-60">Server</span></p>
            <div className="mt-8 flex items-center gap-6">
               <div className="flex-1 space-y-2">
                  <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground italic mb-1">Status Protocol</p>
                  <p className={`text-xl font-black tracking-tight uppercase ${status?.openClawHealth?.isHealthy ? 'text-success' : 'text-error'}`}>
                    {status?.openClawHealth?.statusMessage || 'Initializing...'}
                  </p>
                  <div className="flex items-center gap-2 mt-4 text-[9px] font-black text-muted-foreground uppercase tracking-widest opacity-40">
                    <Clock size={12} />
                    Last check: {status?.openClawHealth?.lastCheck ? new Date(status.openClawHealth.lastCheck).toLocaleTimeString() : 'Never'}
                  </div>
               </div>
               <div className={`w-12 h-12 rounded-full flex items-center justify-center border-4 ${status?.openClawHealth?.isHealthy ? 'border-success/20 text-success' : 'border-error/20 text-error'}`}>
                 <Activity size={20} className={status?.openClawHealth?.isHealthy ? 'animate-pulse' : ''} />
               </div>
            </div>
          </div>
        </div>

        {/* Node Summary */}
        <div className="glass-panel p-8 rounded-[40px] flex items-center gap-8 border-border/50">
           <div className="flex flex-col flex-1 gap-3">
             <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${status?.nodes.some(n => n.status === 'ONLINE') ? 'bg-success animate-pulse shadow-[0_0_12px_rgba(34,197,94,0.6)]' : 'bg-error shadow-[0_0_12px_rgba(239,68,68,0.6)]'}`} />
                <span className="text-[11px] font-black uppercase tracking-[0.2em] italic opacity-80">Infrastructure Status</span>
             </div>
             <p className="text-5xl font-black tracking-tighter italic">{status?.nodes.filter(n => n.status === 'ONLINE').length}<span className="text-2xl opacity-10 mx-2">/</span><span className="text-2xl opacity-20">{status?.nodes.length}</span></p>
             <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest italic opacity-60">Neural Threads Synchronized</p>
           </div>
           <div className="w-px h-24 bg-border/40 hidden xl:block" />
           <div className="flex flex-col flex-1 gap-4 group cursor-pointer" onClick={onRefreshNodes}>
              <span className="text-[11px] font-black uppercase tracking-[0.2em] text-muted-foreground group-hover:text-primary transition-colors italic">Topology Layer</span>
              <p className="text-base font-black tracking-tight italic uppercase text-primary">Hybrid Matrix</p>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-bold uppercase tracking-widest">
                  <Globe size={12} className="text-primary/60" /> Edge Link Active
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-bold uppercase tracking-widest">
                  <Terminal size={12} className="text-success/60" /> VPN Bound (10.2.0.1)
                </div>
              </div>
           </div>
        </div>
      </div>

      {/* Nodes Detailed Grid */}
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between px-2">
          <h3 className="font-black italic flex items-center gap-3 text-sm tracking-[0.2em] uppercase opacity-90">
            <Activity size={20} className="text-primary"/> DISCOVERED NEURAL ENTITIES
          </h3>
          <div className="flex gap-4">
            <button onClick={onRefreshNodes} className="text-[10px] font-black px-6 py-3 bg-surface border border-border rounded-2xl hover:bg-surface-hover hover:border-primary/40 transition-all uppercase tracking-[0.2em] italic flex items-center gap-3 shadow-lg active:scale-95">
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} /> SYNCHRONIZE TOPOLOGY
            </button>
            <button onClick={onPrune} className="text-[10px] font-black px-6 py-3 bg-error/10 text-error border border-error/20 rounded-2xl hover:bg-error/20 transition-all uppercase tracking-[0.2em] italic shadow-lg active:scale-95">DE-PROVISION OFFLINE</button>
          </div>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {status?.nodes.map((node) => (
            <div key={node.id} className="p-6 bg-surface/90 border border-white/5 rounded-[40px] overflow-hidden group hover:bg-surface/95 hover:border-border transition-all flex flex-col gap-5 relative">
              <div className="flex items-start justify-between relative z-10">
                <div className={`p-4 rounded-3xl border shadow-lg ${node.status === 'ONLINE' ? 'bg-success/10 border-success/30 text-success shadow-success/5' : 'bg-muted border-border text-muted-foreground opacity-50 shadow-none'}`}>
                  <Cpu size={24} />
                </div>
                <div className="flex flex-col items-end">
                   <span className={`text-[10px] font-black px-3 py-1 rounded-xl border uppercase tracking-widest italic shadow-sm ${node.status === 'ONLINE' ? 'bg-success/15 border-success/40 text-success' : 'bg-muted border-border text-muted-foreground'}`}>
                      {node.status}
                   </span>
                   {node.version && <span className="text-[9px] font-mono font-black opacity-30 mt-2 uppercase tracking-tighter">BUILD_{node.version}</span>}
                </div>
              </div>
              
              <div className="relative z-10">
                <h4 className="font-black text-base tracking-tight truncate group-hover:text-primary transition-colors uppercase italic">{node.name || node.id}</h4>
                <p className="text-[11px] text-muted-foreground opacity-60 font-mono font-bold truncate mt-1 flex items-center gap-2">
                  <Globe size={12} className="text-primary/40" /> {node.address || node.url}
                </p>
              </div>

              <div className="h-px bg-white/5 w-full my-1" />

              <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest opacity-60 italic">
                 <div className="flex items-center gap-2">
                    <Clock size={12} />
                    {node.last_heartbeat ? `LAST PULSE: ${Math.floor((Date.now() - node.last_heartbeat) / 1000)}S` : 'SIGNAL VOID'}
                 </div>
                 <div className="p-1 px-3 bg-surface border border-border rounded-xl group-hover:border-primary/40 transition-colors shadow-inner">
                    #{node.id.split('_').pop() || '00'}
                 </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* RESTORED CONFIGURATION CONSOLE (CRITICAL) */}
      <div className="flex flex-col gap-8 pb-10">
         <h3 className="font-black italic flex items-center gap-3 text-sm tracking-[0.2em] uppercase opacity-90">
            <Shield size={20} className="text-warning"/> GATEWAY PROTOCOL OVERRIDE
         </h3>

         <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
            {/* Gemini Config */}
            <div className="glass-panel p-8 rounded-[48px] border-primary/10 flex flex-col gap-8 group/cfg relative">
               <div className="flex items-center gap-4">
                  <div className="p-4 bg-primary/10 rounded-3xl text-primary shadow-lg shadow-primary/5 group-hover/cfg:scale-110 transition-transform">
                     <Zap size={24} />
                  </div>
                  <div>
                     <h4 className="font-black text-lg tracking-tight uppercase italic underline decoration-primary/40 decoration-4 underline-offset-8">Google AI Cloud Link</h4>
                     <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest mt-2 opacity-60 italic">Provision API Keys & Model Parameters</p>
                  </div>
               </div>

               <div className="grid grid-cols-1 gap-6">
                  <div className="space-y-3">
                     <label className="text-[11px] font-black text-muted-foreground uppercase tracking-widest ml-1 italic flex items-center gap-2">
                        <Key size={12} className="text-primary" /> API Key Authentication
                     </label>
                     <input 
                        type="password"
                        placeholder="••••••••••••••••••••••••••••••••"
                        value={config?.gemini?.apiKey || ''}
                        onChange={(e) => onUpdateConfig({ gemini: { ...config?.gemini, apiKey: e.target.value } })}
                        className="w-full bg-surface border border-border rounded-2xl p-4 outline-none focus:border-primary font-mono font-black text-sm shadow-inner transition-all hover:border-primary/40"
                     />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                     <div className="space-y-3">
                        <label className="text-[11px] font-black text-muted-foreground uppercase tracking-widest ml-1 italic">Active Model ID</label>
                        <input 
                           type="text"
                           placeholder="google/gemini-pro-1.5"
                           value={config?.gemini?.model || ''}
                           onChange={(e) => onUpdateConfig({ gemini: { ...config?.gemini, model: e.target.value } })}
                           className="w-full bg-surface border border-border rounded-2xl p-4 outline-none focus:border-primary font-mono font-black text-sm shadow-inner transition-all hover:border-primary/40"
                        />
                     </div>
                     <div className="space-y-3">
                        <label className="text-[11px] font-black text-muted-foreground uppercase tracking-widest ml-1 italic">Daily Rate Cap</label>
                        <input 
                           type="number"
                           value={config?.gemini?.dailyQuotaCap || 10000000}
                           onChange={(e) => onUpdateConfig({ gemini: { ...config?.gemini, dailyQuotaCap: parseInt(e.target.value) } })}
                           className="w-full bg-surface border border-border rounded-2xl p-4 outline-none focus:border-primary font-mono font-black text-sm shadow-inner transition-all hover:border-primary/40"
                        />
                     </div>
                  </div>
               </div>
            </div>
            {/* OpenRouter Config */}
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

            {/* FreeLLMAPI Config */}
            <div className="glass-panel p-8 rounded-[48px] border-indigo-500/10 flex flex-col gap-8 group/cfg relative bg-[#070a14]/[0.4]">
               <div className="flex items-center gap-4">
                  <div className="p-4 bg-indigo-500/10 rounded-3xl text-indigo-400 shadow-lg shadow-indigo-500/5 group-hover/cfg:scale-110 transition-transform">
                     <Cloud size={24} />
                  </div>
                  <div>
                     <h4 className="font-black text-lg tracking-tight uppercase italic underline decoration-indigo-500/40 decoration-4 underline-offset-8">FreeLLMAPI Proxy</h4>
                     <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest mt-2 opacity-60 italic">Private Proxy Network Integration</p>
                  </div>
               </div>

               <div className="grid grid-cols-1 gap-6">
                  <div className="space-y-3">
                     <label className="text-[11px] font-black text-muted-foreground uppercase tracking-widest ml-1 italic flex items-center gap-2">
                        <Key size={12} className="text-indigo-400" /> Proxy API Key
                     </label>
                     <input 
                        type="password"
                        placeholder="••••••••••••••••••••••••••••••••"
                        value={config?.freellmapi?.apiKey || ''}
                        onChange={(e) => onUpdateConfig({ freellmapi: { ...config?.freellmapi, apiKey: e.target.value } })}
                        className="w-full bg-surface border border-border rounded-2xl p-4 outline-none focus:border-indigo-500 font-mono font-black text-sm shadow-inner transition-all hover:border-indigo-500/40"
                     />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                     <div className="space-y-3">
                        <label className="text-[11px] font-black text-muted-foreground uppercase tracking-widest ml-1 italic">Proxy Base URL</label>
                        <input 
                           type="text"
                           placeholder="http://10.2.0.54:3001"
                           value={config?.freellmapi?.baseUrl || ''}
                           onChange={(e) => onUpdateConfig({ freellmapi: { ...config?.freellmapi, baseUrl: e.target.value } })}
                           className="w-full bg-surface border border-border rounded-2xl p-4 outline-none focus:border-indigo-500 font-mono font-black text-sm shadow-inner transition-all hover:border-indigo-500/40"
                        />
                     </div>
                     <div className="space-y-3">
                        <label className="text-[11px] font-black text-muted-foreground uppercase tracking-widest ml-1 italic">Target Model</label>
                        <input 
                           type="text"
                           placeholder="auto"
                           value={config?.freellmapi?.model || ''}
                           onChange={(e) => onUpdateConfig({ freellmapi: { ...config?.freellmapi, model: e.target.value } })}
                           className="w-full bg-surface border border-border rounded-2xl p-4 outline-none focus:border-indigo-500 font-mono font-black text-sm shadow-inner transition-all hover:border-indigo-500/40"
                        />
                     </div>
                  </div>
                  
                  <div className="flex items-center gap-4">
                     <label className="flex items-center gap-3 cursor-pointer">
                        <input 
                           type="checkbox"
                           checked={config?.freellmapi?.enabled || false}
                           onChange={(e) => onUpdateConfig({ freellmapi: { ...config?.freellmapi, enabled: e.target.checked } })}
                           className="w-5 h-5 rounded accent-indigo-500 bg-surface border-border"
                        />
                        <span className="text-[11px] font-black uppercase tracking-widest text-muted-foreground italic">Enable Proxy Link</span>
                     </label>
                  </div>
               </div>
            </div>

            {/* Ollama Config */}
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
         </div>

         {/* RESTORED GLOBAL ROUTING SELECTOR (CRITICAL) */}
         <div className="p-8 rounded-[48px] border border-primary/20 bg-primary/5 flex flex-col md:flex-row items-center justify-between gap-8 group/routing">
            <div className="flex items-center gap-6">
               <div className="p-5 bg-primary text-white rounded-[32px] shadow-2xl shadow-primary/40 group-hover/routing:scale-110 transition-all duration-500">
                  <Activity size={32} />
               </div>
               <div>
                  <h4 className="font-black text-2xl tracking-tighter uppercase italic">Inference Logic Override</h4>
                  <p className="text-xs text-foreground/60 font-bold mt-1 uppercase tracking-widest">Select the default analytical brain for cluster tasks</p>
               </div>
            </div>

            <div className="flex flex-wrap p-2 bg-surface border border-border rounded-[32px] w-full md:w-auto shadow-inner gap-2">
               {[
                  { id: 'AUTO', label: 'Automatic (Balanced)', icon: Activity, color: 'text-primary' },
                  ...(status?.nodes || []).filter(n => n.status === 'ONLINE').map(n => ({
                    id: n.id,
                    label: n.id === 'SERVER_LOCAL' ? 'Neural Core (Server)' : (n.type === 'pc_client' || n.id === 'LAPTOP') ? 'Local Compute (PC)' : `${n.name || n.id} (Mesh Node)`,
                    icon: n.id === 'SERVER_LOCAL' ? Database : Cpu,
                    color: n.id === 'SERVER_LOCAL' ? 'text-warning' : 'text-primary'
                  })),
                  { id: 'GEMINI', label: 'Gemini', icon: Zap, color: 'text-primary' },
                  { id: 'OPENROUTER', label: 'OpenRouter', icon: Globe, color: 'text-secondary' },
                  { id: 'FREELLMAPI', label: 'FreeLLMAPI', icon: Cloud, color: 'text-indigo-400' }
               ].map(pref => (
                  <button 
                     key={pref.id}
                     onClick={() => onUpdateConfig({ routing: { ...config?.routing, preferredNode: pref.id } })}
                     className={`px-6 py-4 rounded-[26px] transition-all flex items-center justify-center gap-3 font-black text-[11px] uppercase tracking-[0.2em] border-2 italic ${config?.routing?.preferredNode === pref.id ? 'bg-surface shadow-2xl border-primary/40 text-primary scale-105 z-10' : 'text-foreground/40 border-transparent hover:text-foreground/80 hover:bg-white/5'}`}
                  >
                     <pref.icon size={16} className={config?.routing?.preferredNode === pref.id ? pref.color : 'opacity-40'} />
                     {pref.label}
                  </button>
               ))}
            </div>
         </div>

         <TaskPriorityManager 
            priorities={config?.routing?.taskPriorities || {}}
            onChange={(taskPriorities) => onUpdateConfig({ routing: { ...config?.routing, taskPriorities } })}
            availableNodes={status?.nodes || []}
         />

         <button 
            onClick={() => onToggleBrake(!status?.infrastructureBrake)}
            className={`p-6 border-2 rounded-[40px] flex items-center gap-6 mt-4 w-full text-left transition-all active:scale-[0.98] group ${status?.infrastructureBrake ? 'bg-error border-error shadow-[0_0_30px_rgba(239,68,68,0.4)]' : 'bg-error/10 border-error/20 hover:border-error/40'}`}
         >
            <div className={`p-4 rounded-2xl shadow-lg transition-colors ${status?.infrastructureBrake ? 'bg-white text-error' : 'bg-error text-white'}`}>
               <Shield size={24} className={status?.infrastructureBrake ? 'animate-pulse' : ''} />
            </div>
            <div className="flex-1">
               <p className={`font-black text-sm uppercase italic tracking-tighter ${status?.infrastructureBrake ? 'text-white' : 'text-foreground'}`}>
                  {status?.infrastructureBrake ? 'Infrastructure Brake: ENGAGED' : 'Infrastructure Brake: READY'}
               </p>
               <p className={`text-xs font-bold ${status?.infrastructureBrake ? 'text-white/80' : 'text-foreground/60'}`}>
                  {status?.infrastructureBrake 
                    ? 'SYSTEM PAUSED. All autonomous tasks are suspended and active inferences have been aborted to preserve stability.' 
                    : 'Click to engage manual system-wide brake. This will pause all autonomous task execution and abort active tasks.'}
               </p>
            </div>
            <div className={`px-6 py-2 rounded-2xl border-2 font-black text-[10px] uppercase tracking-widest ${status?.infrastructureBrake ? 'bg-white/20 border-white/40 text-white' : 'bg-error/10 border-error/40 text-error group-hover:bg-error group-hover:text-white'}`}>
               {status?.infrastructureBrake ? 'RELEASE' : 'ENGAGE'}
            </div>
         </button>
      </div>
    </div>
  );
}
