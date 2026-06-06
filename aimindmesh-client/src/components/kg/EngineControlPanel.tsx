import { BrainCircuit, RefreshCw, X, Trash2 } from 'lucide-react';
import { useKnowledgeStore } from '../../store/knowledgeStore';

interface EngineControlPanelProps {
  onPurgeComplete?: () => void;
}

export default function EngineControlPanel({ onPurgeComplete }: EngineControlPanelProps) {
  const {
    syncGitea,
    restartPool,
    stopIngestion,
    purgeQueue,
    clearHistory,
    deleteAllDocuments
  } = useKnowledgeStore();

  const handlePurgeAll = async () => {
    if (!confirm('EXTREMELY CRITICAL: Purge the entire Knowledge Base? This cannot be undone.')) return;
    try {
      await deleteAllDocuments();
      if (onPurgeComplete) {
        onPurgeComplete();
      }
    } catch (err) {
      alert('Purge failed.');
    }
  };

  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 glass-panel rounded-2xl border-primary/20 bg-primary/5">
      <div className="flex items-center gap-4">
        <div className="p-2.5 bg-primary text-white rounded-xl shadow-lg shadow-primary/20">
          <BrainCircuit size={18} />
        </div>
        <div>
          <h3 className="text-sm font-black tracking-tight uppercase italic">Engine Control</h3>
          <p className="text-[9px] text-muted-foreground font-bold uppercase tracking-widest opacity-60">Neural Ingestion Stream</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={syncGitea} className="px-3 py-1.5 bg-surface border border-border rounded-lg text-[9px] font-bold uppercase tracking-widest flex items-center gap-2 hover:bg-surface-hover transition-all">
          <RefreshCw size={12} className="text-primary" /> Sync Gitea
        </button>
        <button onClick={restartPool} className="px-3 py-1.5 bg-surface border border-border rounded-lg text-[9px] font-bold uppercase tracking-widest flex items-center gap-2 hover:bg-surface-hover transition-all">
          <RefreshCw size={12} className="text-warning" /> Restart Pool
        </button>
        <button onClick={stopIngestion} className="px-3 py-1.5 bg-surface border border-border rounded-lg text-[9px] font-bold uppercase tracking-widest flex items-center gap-2 hover:bg-surface-hover transition-all text-error">
          <X size={12} /> Stop Workers
        </button>
        <button onClick={purgeQueue} className="px-3 py-1.5 bg-error/20 border border-error/20 text-error rounded-lg text-[9px] font-bold uppercase tracking-widest flex items-center gap-2 hover:bg-error/30 transition-all">
          <Trash2 size={12} /> Stop & Purge
        </button>
        <button onClick={clearHistory} className="px-3 py-1.5 bg-surface border border-border text-muted-foreground rounded-lg text-[9px] font-bold uppercase tracking-widest flex items-center gap-2 hover:bg-surface-hover transition-all">
          <RefreshCw size={12} /> Clear History
        </button>
        <button onClick={handlePurgeAll} className="px-3 py-1.5 bg-surface border border-border text-muted-foreground rounded-lg text-[9px] font-bold uppercase tracking-widest flex items-center gap-2 hover:bg-error/10 hover:text-error transition-all ml-1">
          <Trash2 size={12} /> Wipe All
        </button>
      </div>
    </div>
  );
}
