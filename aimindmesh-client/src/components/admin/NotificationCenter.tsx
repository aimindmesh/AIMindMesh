import { Bell, Shield, Send, History, Clock, CheckCircle2, XCircle, User } from 'lucide-react';
import { useState } from 'react';

interface FcmLog {
  id: string;
  timestamp: string;
  message: string;
  recipient: string;
  status: 'SUCCESS' | 'FAILED';
}

interface NotificationCenterProps {
  status: any;
  fcmLogs: FcmLog[];
  onTestNotification: (token: string) => void;
  config: any;
  onUpdateConfig: (partial: any) => void;
}

export function NotificationCenter({ status, fcmLogs, onTestNotification, config, onUpdateConfig }: NotificationCenterProps) {
  const [testToken, setTestToken] = useState('');

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 animate-in fade-in duration-500">
      <div className="xl:col-span-2 flex flex-col gap-6">
        {/* Gateway Status */}
        <div className={`p-8 rounded-[40px] border-2 flex items-center justify-between shadow-2xl transition-all ${status?.fcmStatus ? 'bg-success/5 border-success/30' : 'bg-error/5 border-error/30'}`}>
          <div className="flex items-center gap-6">
            <div className={`p-4 rounded-3xl ${status?.fcmStatus ? 'bg-success text-white' : 'bg-error text-white'} shadow-lg`}>
              <Bell size={32} />
            </div>
            <div>
              <h3 className="font-black text-2xl tracking-tighter italic uppercase">Neural Push Gateway</h3>
              <p className="text-sm text-foreground/70 font-bold mt-1">
                {status?.fcmStatus ? 'Relay established via Firebase Cloud Messaging' : 'Gateway dormant - Verify service account credentials'}
              </p>
            </div>
          </div>
          <div className={`px-6 py-2 rounded-2xl text-xs font-black uppercase tracking-[0.2em] border-2 ${status?.fcmStatus ? 'bg-success/20 border-success/40 text-success' : 'bg-error/20 border-error/40 text-error'}`}>
            {status?.fcmStatus ? 'ACTIVE_LINK' : 'VOID_SIGNAL'}
          </div>
        </div>

        {/* Quiet Hours */}
        <div className="glass-panel p-8 rounded-[48px] border-primary/10">
          <div className="flex items-center justify-between mb-8">
             <h2 className="text-2xl font-black italic flex items-center gap-3 tracking-tighter uppercase">
                <Clock className="w-6 h-6 text-primary" /> Signal Throttling
             </h2>
             <span className="text-[10px] font-black px-4 py-1.5 bg-primary/10 text-primary border border-primary/30 rounded-xl uppercase tracking-[0.2em] italic">Availability Logic</span>
          </div>
          
          <div className="space-y-6">
             <div className="flex items-center justify-between p-6 bg-surface/50 rounded-3xl border border-white/5 group hover:bg-surface-hover transition-all">
                <div className="flex items-center gap-4">
                   <div className="p-3 bg-muted rounded-2xl group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                      <Shield size={20} />
                   </div>
                   <div>
                      <p className="text-base font-black uppercase tracking-tight italic">Quiet Hours Override</p>
                      <p className="text-xs text-muted-foreground mt-0.5 font-bold">Suppress synaptic pulses during specific intervals.</p>
                   </div>
                </div>
                <button 
                  onClick={() => onUpdateConfig({ delivery: { ...config?.delivery, quietHours: !config?.delivery?.quietHours } })}
                  className={`w-14 h-8 rounded-full transition-all relative shadow-inner ${config?.delivery?.quietHours ? 'bg-primary' : 'bg-muted'}`}
                >
                  <div className={`absolute top-1.5 w-5 h-5 bg-white rounded-full transition-all shadow-md ${config?.delivery?.quietHours ? 'left-7.5' : 'left-1.5'}`} />
                </button>
             </div>

             <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-6">
                <div className="space-y-3">
                   <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em] mb-2 px-1 italic">Window Start</p>
                   <input 
                     type="time" 
                     value={config?.delivery?.quietStart || '23:00'} 
                     onChange={(e) => onUpdateConfig({ delivery: { ...config.delivery, quietStart: e.target.value } })}
                     className="w-full bg-surface border border-border p-4 rounded-2xl outline-none focus:border-primary text-sm font-black font-mono shadow-inner transition-all hover:border-primary/40"
                   />
                </div>
                <div className="space-y-3">
                   <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em] mb-2 px-1 italic">Window End</p>
                   <input 
                     type="time" 
                     value={config?.delivery?.quietEnd || '08:00'} 
                     onChange={(e) => onUpdateConfig({ delivery: { ...config.delivery, quietEnd: e.target.value } })}
                     className="w-full bg-surface border border-border p-4 rounded-2xl outline-none focus:border-primary text-sm font-black font-mono shadow-inner transition-all hover:border-primary/40"
                   />
                </div>
             </div>
          </div>
        </div>

        {/* Neural Pulse Test */}
        <div className="glass-panel p-8 rounded-[48px] border-white/5 bg-[#070a14]/[0.4]">
          <h2 className="text-2xl font-black italic mb-8 flex items-center gap-3 tracking-tighter uppercase">
            <Send className="w-6 h-6 text-primary" /> Diagnostic Emitter
          </h2>
          <div className="flex gap-4">
             <input 
               type="text" 
               placeholder="Destination Neural ID (FCM Token)..." 
               value={testToken}
               onChange={(e) => setTestToken(e.target.value)}
               className="flex-1 bg-surface border border-border p-4 rounded-2xl outline-none focus:border-primary text-sm font-mono font-black shadow-inner transition-all hover:border-primary/40"
             />
             <button 
               onClick={() => onTestNotification(testToken)}
               disabled={!testToken}
               className="px-8 py-4 bg-primary text-white rounded-2xl font-black text-xs uppercase tracking-[0.25em] shadow-2xl shadow-primary/30 hover:scale-105 active:scale-95 transition-all disabled:opacity-30 flex items-center gap-3 border-b-4 border-black/20"
             >
               <Send size={18} /> Emit Pulse
             </button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-6 max-h-[1000px]">
        <h2 className="text-2xl font-black italic flex items-center gap-3 tracking-tighter uppercase mb-2">
          <History className="w-6 h-6 text-muted-foreground" /> Relay History
        </h2>
        <div className="glass-panel p-3 rounded-[40px] flex-1 flex flex-col min-h-0 overflow-y-auto border-border/40 custom-scrollbar">
          {fcmLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-12 text-center opacity-30">
               <Bell size={48} className="mb-4" />
               <p className="text-xs font-black uppercase tracking-[0.3em] italic">Registry Void</p>
               <p className="text-[10px] font-bold mt-2">Waiting for synaptic signals.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {fcmLogs.slice(0, 10).map((log) => (
                <div key={log.id} className="p-5 bg-surface/80 hover:bg-surface-hover rounded-[32px] border border-white/5 hover:border-border transition-all flex flex-col gap-3 group">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-2">
                       {log.status === 'SUCCESS' ? (
                         <CheckCircle2 size={12} className="text-success" />
                       ) : (
                         <XCircle size={12} className="text-error" />
                       )}
                       <span className={`font-black text-[11px] uppercase tracking-[0.15em] italic ${log.status === 'SUCCESS' ? 'text-success' : 'text-error'}`}>
                          {log.status === 'SUCCESS' ? 'DELIVERED' : 'BOUNCED'}
                       </span>
                    </div>
                    <span className="text-[10px] text-white/40 font-mono font-black shrink-0 tracking-tighter">
                       {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  
                  <p className="text-[13px] text-white font-black leading-tight tracking-tight selection:bg-primary/30 group-hover:scale-[1.01] transition-transform origin-left">
                     {log.message}
                  </p>

                  <div className="flex items-center gap-2 mt-1 opacity-40 group-hover:opacity-100 transition-opacity">
                     <User size={10} className="text-primary" />
                     <span className="text-[9px] font-mono font-black text-muted-foreground truncate max-w-[180px]">REC: {log.recipient}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
