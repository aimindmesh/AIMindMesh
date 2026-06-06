import { useEffect, useState, useCallback } from 'react';
import { MonitorDot, Play, List, Trash2, RefreshCw, ExternalLink, Activity } from 'lucide-react';
import { kasmApi } from '../services/api';
import { Browser } from '@capacitor/browser';

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
      console.error('Failed to fetch Kasm status', err);
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
      console.error('Failed to fetch Kasm images', err);
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
      alert('Failed to create session');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDestroySession = async (id: string) => {
    if (!window.confirm('Destroy this workspace?')) return;
    try {
      await kasmApi.destroySession(id);
      await fetchStatus();
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message;
      alert(`Failed to destroy session: ${msg}`);
    }
  };

  const openSession = async (url: string) => {
    await Browser.open({ url });
  };

  if (isLoading && !status) {
    return (
      <div className="view-content flex flex-col items-center justify-center p-10 opacity-50">
        <MonitorDot className="w-12 h-12 text-primary animate-pulse mb-6" />
        <p className="text-[10px] font-black uppercase tracking-[0.4em] animate-pulse">Syncing with Kasm Cluster...</p>
      </div>
    );
  }

  return (
    <div className="view-content p-4 pb-6 animate-fade-in custom-scrollbar">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 pt-2">
        <div>
          <h1 className="text-2xl font-black tracking-tighter italic uppercase">Kasm Workspaces</h1>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-0.5">Isolated Synthetic Nodes</p>
        </div>
        <div className={`p-2 px-3 rounded-xl border flex items-center gap-2 ${status?.enabled ? 'bg-success/5 border-success/20' : 'bg-error/5 border-error/20'}`}>
          <div className={`w-1.5 h-1.5 rounded-full ${status?.enabled ? 'bg-success animate-pulse' : 'bg-error'}`} />
          <span className={`text-[8px] font-black uppercase tracking-widest ${status?.enabled ? 'text-success' : 'text-error'}`}>
            {status?.enabled ? 'ACTIVE' : 'OFFLINE'}
          </span>
        </div>
      </div>

      {/* Quick Launch */}
      <div className="glass-panel p-5 rounded-3xl mb-6 relative overflow-hidden group">
        <div className="flex items-center gap-3 mb-4">
          <Play className="w-4 h-4 text-primary" />
          <h2 className="text-xs font-black uppercase tracking-widest italic">Quick Spawn</h2>
        </div>
        
        <div className="flex flex-col gap-3">
          <div className="relative">
             <select 
              value={selectedImage}
              onChange={(e) => setSelectedImage(e.target.value)}
              className="w-full bg-input/50 border border-border p-4 rounded-2xl text-xs font-bold appearance-none outline-none focus:border-primary/50 transition-all pr-10"
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
            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none opacity-40">
              <List size={14} />
            </div>
          </div>
          
          <button 
            onClick={handleCreateSession}
            disabled={isCreating || !selectedImage || !status?.enabled}
            className="btn-primary w-full py-4 rounded-2xl flex items-center justify-center gap-3 disabled:opacity-30"
          >
            {isCreating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            <span>{isCreating ? 'Spawning...' : 'Start Workspace'}</span>
          </button>
        </div>
      </div>

      {/* Active Sessions */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4 px-1">
          <div className="flex items-center gap-3">
            <List className="w-4 h-4 text-primary" />
            <h2 className="text-xs font-black uppercase tracking-widest italic">Active Sessions ({sessions.length})</h2>
          </div>
          <button onClick={fetchStatus} className="p-2 hover:bg-white/5 rounded-xl transition-colors">
            <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>

        <div className="space-y-3">
          {sessions.length === 0 ? (
            <div className="p-10 text-center opacity-30 border-2 border-dashed border-border rounded-3xl">
              <p className="text-[9px] font-black uppercase tracking-[0.2em]">No active nodes</p>
            </div>
          ) : (
            sessions.map((session) => (
              <div key={session.kasm_id} className="p-4 bg-surface/50 border border-border/50 rounded-2xl flex flex-col gap-4 animate-slide-up">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col min-w-0">
                    <span className="text-[8px] font-black uppercase tracking-widest text-primary mb-1">Session ID</span>
                    <span className="text-[10px] font-mono opacity-50 truncate">{session.kasm_id.substring(0, 16)}...</span>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button 
                      onClick={() => openSession(session.kasm_url)}
                      className="p-3 bg-primary/10 text-primary rounded-xl active:scale-90 transition-all border border-primary/20"
                    >
                      <ExternalLink size={16} />
                    </button>
                    <button 
                      onClick={() => handleDestroySession(session.kasm_id)}
                      className="p-3 bg-error/10 text-error rounded-xl active:scale-90 transition-all border border-error/20"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-2 px-3 bg-background/50 rounded-xl">
                  <MonitorDot size={12} className="text-muted-foreground" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground truncate">
                    {session.image_id || 'Ubuntu Desktop'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Info Card */}
      <div className="glass-panel p-5 rounded-3xl opacity-70">
        <div className="flex items-center gap-3 mb-4">
          <Activity className="w-4 h-4 text-warning" />
          <h2 className="text-xs font-black uppercase tracking-widest italic">Sandbox Engine</h2>
        </div>
        <p className="text-[10px] leading-relaxed text-muted-foreground uppercase font-bold tracking-tight">
          Workspaces are transient, isolated environments used by the AI to execute code, browse the web securely, and manage synthetic tasks without risking host integrity.
        </p>
      </div>
    </div>
  );
}
