import { FileText, X, Activity } from 'lucide-react';

interface DocumentViewerModalProps {
  selectedDoc: {
    id: string;
    title: string;
    chunks?: {
      index: number;
      text: string;
    }[];
  } | null;
  onClose: () => void;
}

export default function DocumentViewerModal({ selectedDoc, onClose }: DocumentViewerModalProps) {
  if (!selectedDoc) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/90 backdrop-blur-md animate-fade-in"
      onClick={onClose}
    >
      <div 
        className="bg-surface w-full max-w-4xl max-h-[90vh] rounded-3xl flex flex-col shadow-2xl border border-white/10 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-white/5 flex items-center justify-between bg-surface/50 backdrop-blur-xl">
          <div className="flex items-center gap-4">
            <div className="p-2.5 bg-primary/20 rounded-xl">
              <FileText className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h3 className="font-bold text-lg leading-none text-slate-100">{selectedDoc.title || 'Extracted Content'}</h3>
              <p className="text-[10px] text-muted-foreground mt-1.5 font-mono uppercase tracking-[0.2em] opacity-70">Neural Inspection Layer • {selectedDoc.id}</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="bg-surface hover:bg-surface-hover p-2.5 rounded-xl transition-all border border-white/5 shadow-lg group"
            title="Close Viewer"
          >
            <X className="w-5 h-5 text-muted-foreground group-hover:text-slate-100 transition-colors" />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-8 space-y-6 bg-background/20 scrollbar-thin scrollbar-thumb-white/10">
          {(!selectedDoc.chunks || selectedDoc.chunks.length === 0) ? (
            <div className="flex flex-col items-center justify-center py-20 opacity-50">
               <Activity className="w-12 h-12 mb-4 animate-pulse text-primary" />
               <p className="font-bold tracking-widest uppercase text-xs">No neural fragments found</p>
            </div>
          ) : (
            selectedDoc.chunks.map((chunk) => (
              <div key={chunk.index} className="glass-panel p-6 rounded-2xl border-white/10 bg-surface/10 hover:bg-surface/20 transition-colors flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-black text-primary px-3 py-1 bg-primary/10 border border-primary/30 rounded-full uppercase tracking-[0.15em]">
                    Fragment #{chunk.index + 1}
                  </span>
                </div>
                <p className="text-[15px] leading-relaxed text-slate-300 whitespace-pre-wrap font-sans selection:bg-primary/40 selection:text-white">
                  {chunk.text}
                </p>
              </div>
            ))
          )}
          
          <div className="flex justify-center pt-8 pb-4">
            <button 
              onClick={onClose}
              className="px-8 py-3 bg-surface hover:bg-surface-hover border border-white/10 rounded-2xl text-xs font-bold uppercase tracking-widest transition-all shadow-xl hover:scale-105 active:scale-95"
            >
              Close Inspection
            </button>
          </div>
        </div>

        <div className="p-5 border-t border-white/5 bg-surface/30 flex justify-between items-center px-10 text-[9px] text-muted-foreground/60 font-bold uppercase tracking-[0.2em]">
           <div className="flex items-center gap-2">
             <div className="w-1.5 h-1.5 bg-success rounded-full animate-pulse" />
             <span>Synaptic Link Active</span>
           </div>
           <span>Total Fragments: {selectedDoc.chunks?.length || 0}</span>
        </div>
      </div>
    </div>
  );
}
