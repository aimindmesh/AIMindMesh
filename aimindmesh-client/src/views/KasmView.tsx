import { useEffect, useState, useCallback } from 'react';
import { MonitorDot, Play, Command, List, Trash2, RefreshCw, ExternalLink } from 'lucide-react';
import { kasmApi } from '../services/serverApi';
import { Logger } from '../utils/logger';
import { openUrl } from '@tauri-apps/plugin-opener';

interface KasmSession {
  kasm_id: string;
  kasm_url: string;
  image_id?: string;
  created?: string;
}

interface KasmImage {
  image_id: string;
  friendly_name: string;
  thumbnail_url?: string;
  description?: string;
}

export default function KasmView() {
  const [status, setStatus] = useState<any>(null);
  const [sessions, setSessions] = useState<KasmSession[]>([]);
  const [images, setImages] = useState<KasmImage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedImage, setSelectedImage] = useState('');

  const fetchStatus = useCallback(async () => {
    try {
      const res = await kasmApi.getStatus();
      setStatus(res.data);
      setSessions(res.data.sessions || []);
    } catch (err) {
      Logger.error('KasmView', 'Failed to fetch Kasm status');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchImages = useCallback(async () => {
    try {
      const res = await kasmApi.getImages();
      setImages(res.data);
      if (res.data.length > 0 && !selectedImage) {
        setSelectedImage(res.data[0].image_id);
      }
    } catch (err) {
      Logger.error('KasmView', 'Failed to fetch Kasm images');
    }
  }, [selectedImage]);

  useEffect(() => {
    fetchStatus();
    fetchImages();
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, [fetchStatus, fetchImages]);

  const handleCreateSession = async () => {
    setIsCreating(true);
    try {
      await kasmApi.createSession(selectedImage || undefined);
      await fetchStatus();
    } catch (err) {
      Logger.error('KasmView', 'Failed to create session');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDestroySession = async (id: string) => {
    try {
      await kasmApi.destroySession(id);
      await fetchStatus();
    } catch (err) {
      Logger.error('KasmView', 'Failed to destroy session');
    }
  };

  if (isLoading && !status) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-20 opacity-50">
        <MonitorDot className="w-12 h-12 text-primary animate-pulse mb-6" />
        <p className="text-sm font-black uppercase tracking-[0.4em] animate-pulse italic">Connecting to Kasm Node...</p>
      </div>
    );
  }

  return (
    <div className="p-10 max-w-[1400px] mx-auto w-full flex flex-col gap-10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-5">
          <div className="p-4 rounded-3xl bg-primary/10 border border-primary/20 shadow-[0_0_30px_rgba(79,143,247,0.1)]">
            <MonitorDot className="w-10 h-10 text-primary" />
          </div>
          <div>
            <h1 className="text-4xl font-black tracking-tighter italic">KASM WORKSPACES</h1>
            <p className="text-sm text-muted-foreground uppercase tracking-widest font-bold opacity-60">Isolated Synthetic Environments</p>
          </div>
        </div>

        <div className="flex items-center gap-4 bg-surface-hover/40 p-2 px-6 rounded-2xl border border-border">
          <div className={`w-2 h-2 rounded-full ${status?.enabled ? 'bg-success shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-error'}`} />
          <span className="text-xs font-black uppercase tracking-widest">{status?.enabled ? 'INTEGRATION ACTIVE' : 'INTEGRATION DISABLED'}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Quick Launch Card */}
        <div className="glass-panel p-8 rounded-[32px] border border-white/5 flex flex-col gap-6 shadow-2xl relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
          <div className="flex items-center gap-3">
            <Play className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-black italic">QUICK LAUNCH</h2>
          </div>
          
          <div className="flex flex-col gap-4">
            <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Environment Image</label>
            <select 
              value={selectedImage}
              onChange={(e) => setSelectedImage(e.target.value)}
              className="bg-background/50 border border-border p-4 rounded-2xl text-sm focus:border-primary/50 outline-none transition-all font-bold appearance-none cursor-pointer"
            >
              {images.length === 0 ? (
                <option value="">No images available</option>
              ) : (
                images.map(img => (
                  <option key={img.image_id} value={img.image_id}>
                    {img.friendly_name}
                  </option>
                ))
              )}
            </select>
            
            <button 
              onClick={handleCreateSession}
              disabled={isCreating || !selectedImage}
              className="w-full py-5 bg-primary text-white rounded-2xl font-black uppercase tracking-widest hover:bg-primary-hover transition-all shadow-xl shadow-primary/20 disabled:opacity-50 flex items-center justify-center gap-3"
            >
              {isCreating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {isCreating ? 'SPAWNING...' : 'START WORKSPACE'}
            </button>
          </div>

          {selectedImage && images.find(i => i.image_id === selectedImage)?.description && (
            <p className="text-[10px] text-muted-foreground italic leading-relaxed opacity-60">
              {images.find(i => i.image_id === selectedImage)?.description}
            </p>
          )}
        </div>

        {/* Status Card */}
        <div className="glass-panel p-8 rounded-[32px] border border-white/5 flex flex-col gap-8 shadow-2xl lg:col-span-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <List className="w-5 h-5 text-primary" />
              <h2 className="text-xl font-black italic">ACTIVE SESSIONS ({sessions.length})</h2>
            </div>
            <button onClick={fetchStatus} className="p-2 hover:bg-white/5 rounded-xl transition-colors">
              <RefreshCw className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>

          <div className="flex flex-col gap-4">
            {sessions.length === 0 ? (
              <div className="p-12 text-center opacity-30 border-2 border-dashed border-border rounded-3xl">
                <p className="text-xs font-black uppercase tracking-widest">No active workspaces detected</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {sessions.map((session) => (
                  <div key={session.kasm_id} className="bg-surface/40 border border-border p-5 rounded-2xl flex flex-col gap-4 hover:border-primary/30 transition-all group">
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-black uppercase tracking-widest text-primary mb-1">Session ID</span>
                        <span className="text-xs font-mono opacity-60">{session.kasm_id.substring(0, 12)}...</span>
                      </div>
                      <div className="flex gap-2">
                        <button 
                          onClick={async () => {
                            try {
                              await openUrl(session.kasm_url);
                            } catch (err) {
                              Logger.error('KasmView', 'Failed to open session URL: ' + err);
                            }
                          }}
                          className="p-2 bg-white/5 hover:bg-primary/20 rounded-lg transition-all"
                        >
                          <ExternalLink className="w-4 h-4 text-primary" />
                        </button>
                        <button 
                          onClick={() => handleDestroySession(session.kasm_id)}
                          className="p-2 bg-white/5 hover:bg-error/20 rounded-lg transition-all group-hover:opacity-100"
                        >
                          <Trash2 className="w-4 h-4 text-error" />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-widest opacity-40">
                      <MonitorDot size={12} />
                      <span>{session.image_id || 'Ubuntu Desktop'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Usage Guidelines */}
      <div className="glass-panel p-8 rounded-[32px] border border-white/5 shadow-2xl flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <Command className="w-5 h-5 text-warning" />
          <h2 className="text-xl font-black italic">AGENTIC WORKFLOWS</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="flex flex-col gap-2">
            <h3 className="text-[10px] font-black text-primary uppercase tracking-widest">Safe Execution</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">The AI uses these workspaces to execute user-provided shell scripts or complex code in a complete sandbox.</p>
          </div>
          <div className="flex flex-col gap-2 border-l border-white/5 pl-8">
            <h3 className="text-[10px] font-black text-warning uppercase tracking-widest">Visual Scraping</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">When a website blocks standard scrapers, the agent opens a Kasm browser and captures the UI to "read" the content.</p>
          </div>
          <div className="flex flex-col gap-2 border-l border-white/5 pl-8">
            <h3 className="text-[10px] font-black text-success uppercase tracking-widest">Remote Support</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">Spawn a session and share the URL with the AI to collaborate in real-time in a shared virtual desktop.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
