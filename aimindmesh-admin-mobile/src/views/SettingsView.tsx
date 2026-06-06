import { useState } from 'react';
import { Save, Server, Zap, Cloud, ChevronRight, RefreshCw, Database } from 'lucide-react';
import { useSettingsStore } from '../store/settingsStore';
import { useAdminStore } from '../store/adminStore';
import { CategorizedSelector, SelectorGroup } from '../components/ui/CategorizedSelector';
import { Browser } from '@capacitor/browser';

export default function SettingsView() {
  const { serverUrl, apiKey, setServerUrl, setApiKey } = useSettingsStore();
  const { config, patchConfig, fetchConfig, openrouterModels } = useAdminStore();
  const [url, setUrl] = useState(serverUrl);
  const [key, setKey] = useState(apiKey);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<'connection' | 'ai'>('connection');
  const [isSelectorOpen, setIsSelectorOpen] = useState(false);
  const [selectorConfig, setSelectorConfig] = useState<{ title: string; groups: SelectorGroup[]; onSelect: (v: string) => void; currentValue: string } | null>(null);

  const handleSave = () => {
    setServerUrl(url);
    setApiKey(key);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const updateConfig = async (path: string, value: any) => {
    const parts = path.split('.');
    const update: any = {};
    let curr = update;
    for (let i = 0; i < parts.length - 1; i++) {
      curr[parts[i]] = {};
      curr = curr[parts[i]];
    }
    curr[parts[parts.length - 1]] = value;
    
    try {
      await patchConfig(update);
    } catch (e) {
      console.error("Config update failed", e);
    }
  };

  return (
    <div className="view-content p-4 animate-fade-in">
      <div className="flex gap-1 mb-6 shrink-0 bg-surface/50 p-1 rounded-2xl border border-border/20">
        {(['connection', 'ai'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${
              activeTab === tab ? 'bg-primary text-white shadow-lg' : 'text-muted-foreground'
            }`}
          >
            {tab === 'connection' ? 'Endpoint' : 'Global AI'}
          </button>
        ))}
      </div>

      {activeTab === 'connection' ? (
        <div className="glass-panel rounded-3xl p-6 space-y-6">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Server size={14} className="text-primary opacity-70" />
              <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Server URL</label>
            </div>
            <input
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="http://10.2.0.1:3030"
              className="w-full bg-input border border-border rounded-2xl px-5 py-4 text-sm font-mono outline-none focus:border-primary transition-colors shadow-inner"
            />
            <p className="text-[10px] text-muted-foreground mt-2 px-1">VPN-accessible Server internal IP</p>
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-3 px-1">API Authentication Key</label>
            <input
              type="password"
              value={key}
              onChange={e => setKey(e.target.value)}
              placeholder="X-API-Key header value..."
              className="w-full bg-input border border-border rounded-2xl px-5 py-4 text-sm font-mono outline-none focus:border-primary transition-colors shadow-inner"
            />
          </div>

          <button onClick={handleSave} className={`btn-primary w-full py-5 rounded-2xl shadow-xl transition-all ${saved ? 'bg-success shadow-success/20' : 'shadow-primary/20 active:scale-95'}`}>
            <Save size={16} />
            {saved ? 'Saved!' : 'Save Configuration'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* OpenRouter Section */}
          <div className="glass-panel rounded-3xl p-6 border border-cyan-500/20">
             <div className="flex items-center justify-between mb-5">
               <div className="flex items-center gap-2">
                 <Cloud size={16} className="text-cyan-400" />
                 <h3 className="text-xs font-black uppercase tracking-widest">OpenRouter</h3>
               </div>
               <button onClick={fetchConfig} className="p-2 bg-surface border border-border rounded-xl active:rotate-180 transition-all duration-500">
                 <RefreshCw size={14} className="text-muted-foreground" />
               </button>
             </div>

             <div className="space-y-4">
               <div>
                 <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1.5 block px-1">Preferred Model</label>
                 <button
                    onClick={() => {
                      if (!openrouterModels) return;
                      const groups: SelectorGroup[] = Object.entries(openrouterModels).map(([category, models]) => ({
                        label: category,
                        options: models.map(m => ({ label: m.split('/').pop() || m, value: m, description: m }))
                      }));
                      setSelectorConfig({
                        title: 'Select Model',
                        groups,
                        currentValue: config?.openrouter?.model || '',
                        onSelect: (v) => updateConfig('openrouter.model', v)
                      });
                      setIsSelectorOpen(true);
                    }}
                    className="w-full bg-surface border border-border rounded-2xl p-4 flex items-center justify-between group active:scale-[0.98] transition-all"
                  >
                    <span className="text-xs font-black italic truncate">{config?.openrouter?.model?.split('/').pop() || 'Select Model'}</span>
                    <ChevronRight size={14} className="text-muted-foreground opacity-30" />
                  </button>
               </div>

               <div>
                 <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1.5 block px-1">Daily Token Quota</label>
                 <input
                    type="number"
                    value={config?.openrouter?.dailyQuotaCap || 0}
                    onChange={(e) => updateConfig('openrouter.dailyQuotaCap', parseInt(e.target.value))}
                    className="w-full bg-surface border border-border rounded-2xl p-4 text-sm font-mono font-black outline-none focus:border-cyan-500/50"
                  />
               </div>

               <div className="grid grid-cols-2 gap-3">
                 <div>
                   <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1.5 block px-1">Check every (h)</label>
                   <input
                     type="number"
                     value={config?.openrouter?.creditCheckIntervalHours || 1}
                     onChange={(e) => updateConfig('openrouter.creditCheckIntervalHours', parseInt(e.target.value))}
                     className="w-full bg-surface border border-border rounded-2xl p-4 text-sm font-mono font-black outline-none focus:border-cyan-500/50"
                   />
                 </div>
                 <div>
                   <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1.5 block px-1">Alert Threshold ($)</label>
                   <input
                     type="number"
                     step="0.5"
                     value={config?.openrouter?.lowCreditThreshold || 5}
                     onChange={(e) => updateConfig('openrouter.lowCreditThreshold', parseFloat(e.target.value))}
                     className="w-full bg-surface border border-border rounded-2xl p-4 text-sm font-mono font-black outline-none focus:border-cyan-500/50"
                   />
                 </div>
               </div>
             </div>
          </div>

          {/* FreeLLMAPI Section */}
          <div className="glass-panel rounded-3xl p-6 border border-indigo-500/20 mb-4">
             <div className="flex items-center justify-between mb-5">
               <div className="flex items-center gap-2">
                 <Cloud size={16} className="text-indigo-400" />
                 <h3 className="text-xs font-black uppercase tracking-widest">FreeLLMAPI Proxy</h3>
               </div>
               <button 
                 onClick={() => Browser.open({ url: config?.freellmapi?.baseUrl || 'http://10.2.0.54:3001' })}
                 className="p-2 bg-surface border border-border rounded-xl active:scale-90 transition-all duration-300"
               >
                 <Cloud size={14} className="text-muted-foreground" />
               </button>
             </div>

             <div className="space-y-4">
               <label className="flex items-center gap-3 cursor-pointer">
                 <input
                   type="checkbox"
                   checked={config?.freellmapi?.enabled || false}
                   onChange={(e) => updateConfig('freellmapi.enabled', e.target.checked)}
                   className="w-5 h-5 rounded accent-indigo-500 border-border bg-surface"
                 />
                 <span className="font-bold text-[10px] uppercase tracking-widest text-muted-foreground">Enable FreeLLMAPI</span>
               </label>

               <div>
                 <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1.5 block px-1">Base URL</label>
                 <input
                    type="text"
                    value={config?.freellmapi?.baseUrl || 'http://10.2.0.54:3001'}
                    onChange={(e) => updateConfig('freellmapi.baseUrl', e.target.value)}
                    className="w-full bg-surface border border-border rounded-2xl p-4 text-sm font-mono font-black outline-none focus:border-indigo-500/50"
                  />
               </div>

               <div>
                 <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1.5 block px-1">API Key</label>
                 <input
                    type="password"
                    value={config?.freellmapi?.apiKey || ''}
                    onChange={(e) => updateConfig('freellmapi.apiKey', e.target.value)}
                    className="w-full bg-surface border border-border rounded-2xl p-4 text-sm font-mono font-black outline-none focus:border-indigo-500/50"
                    placeholder="Enter API Key..."
                  />
               </div>

               <div>
                 <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1.5 block px-1">Preferred Model</label>
                 <input
                    type="text"
                    value={config?.freellmapi?.model || 'auto'}
                    onChange={(e) => updateConfig('freellmapi.model', e.target.value)}
                    className="w-full bg-surface border border-border rounded-2xl p-4 text-sm font-mono font-black outline-none focus:border-indigo-500/50"
                    placeholder="e.g. auto"
                  />
               </div>
             </div>
          </div>

          {/* Gemini Section */}
          <div className="glass-panel rounded-3xl p-6 border border-orange-500/20">
             <div className="flex items-center gap-2 mb-5">
               <Zap size={16} className="text-orange-400" />
               <h3 className="text-xs font-black uppercase tracking-widest">Google Gemini</h3>
             </div>

             <div className="space-y-4">
               <div>
                 <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1.5 block px-1">Active Model</label>
                 <button
                    onClick={() => {
                      const groups: SelectorGroup[] = [
                        {
                          label: 'Production Models',
                          options: [
                            { label: 'Gemini 2.0 Flash', value: 'models/gemini-2.0-flash' },
                            { label: 'Gemini 1.5 Flash', value: 'models/gemini-1.5-flash' },
                            { label: 'Gemini 1.5 Pro', value: 'models/gemini-1.5-pro' }
                          ]
                        }
                      ];
                      setSelectorConfig({
                        title: 'Select Gemini Model',
                        groups,
                        currentValue: config?.gemini?.model || '',
                        onSelect: (v) => updateConfig('gemini.model', v)
                      });
                      setIsSelectorOpen(true);
                    }}
                    className="w-full bg-surface border border-border rounded-2xl p-4 flex items-center justify-between group active:scale-[0.98] transition-all"
                  >
                    <span className="text-xs font-black italic truncate">{config?.gemini?.model?.split('/').pop() || 'Select Model'}</span>
                    <ChevronRight size={14} className="text-muted-foreground opacity-30" />
                  </button>
               </div>

               <div>
                 <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1.5 block px-1">Daily Token Quota</label>
                 <input
                    type="number"
                    value={config?.gemini?.dailyQuotaCap || 0}
                    onChange={(e) => updateConfig('gemini.dailyQuotaCap', parseInt(e.target.value))}
                    className="w-full bg-surface border border-border rounded-2xl p-4 text-sm font-mono font-black outline-none focus:border-orange-500/50"
                  />
               </div>
             </div>
          </div>

          {/* Ollama Section */}
          <div className="glass-panel rounded-3xl p-6 border border-yellow-500/20">
             <div className="flex items-center gap-2 mb-5">
               <Database size={16} className="text-yellow-500" />
               <h3 className="text-xs font-black uppercase tracking-widest">Ollama Cluster</h3>
             </div>

             <div className="space-y-4">
               <div>
                 <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1.5 block px-1">Request Timeout (MIN)</label>
                 <input
                    type="number"
                    value={Math.floor((config?.ollama?.timeoutMs || 1800000) / 60000)}
                    onChange={(e) => updateConfig('ollama.timeoutMs', parseInt(e.target.value) * 60000)}
                    className="w-full bg-surface border border-border rounded-2xl p-4 text-sm font-mono font-black outline-none focus:border-yellow-500/50"
                  />
               </div>

               <div>
                 <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1.5 block px-1">Base URL</label>
                 <input
                    type="text"
                    value={config?.ollama?.baseUrl || ''}
                    onChange={(e) => updateConfig('ollama.baseUrl', e.target.value)}
                    className="w-full bg-surface border border-border rounded-2xl p-4 text-sm font-mono font-black outline-none focus:border-yellow-500/50"
                  />
               </div>

               <div>
                 <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1.5 block px-1">Default Model</label>
                 <input
                    type="text"
                    value={config?.ollama?.defaultModel || ''}
                    onChange={(e) => updateConfig('ollama.defaultModel', e.target.value)}
                    className="w-full bg-surface border border-border rounded-2xl p-4 text-sm font-mono font-black outline-none focus:border-yellow-500/50"
                  />
               </div>
             </div>
          </div>
        </div>
      )}

      {/* Selector Modal Overlay */}
      {isSelectorOpen && selectorConfig && (
        <CategorizedSelector
          isOpen={isSelectorOpen}
          onClose={() => setIsSelectorOpen(false)}
          title={selectorConfig.title}
          groups={selectorConfig.groups}
          currentValue={selectorConfig.currentValue}
          onSelect={selectorConfig.onSelect}
        />
      )}

      <div className="mt-6 p-4 rounded-2xl bg-surface/50 border border-border/30">
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Current Endpoint</p>
        <p className="text-xs font-mono text-primary break-all">{serverUrl || '—'}</p>
      </div>
    </div>
  );
}
