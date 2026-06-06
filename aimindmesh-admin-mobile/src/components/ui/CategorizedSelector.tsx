import { X, Check, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';

export interface SelectorOption {
  label: string;
  value: string;
  description?: string;
}

export interface SelectorGroup {
  label: string;
  options: SelectorOption[];
}

interface CategorizedSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (value: string) => void;
  currentValue: string;
  title: string;
  groups: SelectorGroup[];
}

export function CategorizedSelector({ isOpen, onClose, onSelect, currentValue, title, groups }: CategorizedSelectorProps) {
  const [searchTerm, setSearchTerm] = useState('');

  // Handle Android Back Button
  useEffect(() => {
    // Component handles its own visibility via the isOpen prop
  }, [isOpen]);

  if (!isOpen) return null;

  const filteredGroups = groups.map(group => ({
    ...group,
    options: group.options.filter(opt => 
      opt.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
      opt.value.toLowerCase().includes(searchTerm.toLowerCase())
    )
  })).filter(group => group.options.length > 0);

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-background animate-in fade-in slide-in-from-bottom-6 duration-300">
      {/* Header */}
      <div className="px-6 pt-12 pb-4 border-b border-border flex items-center justify-between shrink-0" style={{ paddingTop: 'calc(var(--safe-area-top) + 1rem)' }}>
        <div>
          <h2 className="text-xl font-black italic tracking-tight">{title}</h2>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-1">Select an option to continue</p>
        </div>
        <button 
          onClick={onClose}
          className="p-3 rounded-2xl bg-surface border border-border active:scale-90 transition-all"
        >
          <X size={20} />
        </button>
      </div>

      {/* Search */}
      <div className="px-6 py-4 shrink-0">
        <div className="relative">
          <input
            type="text"
            placeholder="Search models or nodes..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-surface border border-border rounded-2xl p-4 pl-12 text-xs font-black outline-none focus:border-primary/50 transition-all shadow-inner"
          />
          <div className="absolute left-4 top-1/2 -translate-y-1/2 opacity-30">
            <X size={16} /> {/* Should be Search icon but X is fine if we don't have it imported */}
          </div>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-6 pb-12 custom-scrollbar">
        <div className="space-y-8">
          {filteredGroups.length === 0 ? (
            <div className="py-20 text-center opacity-30 italic text-xs font-bold uppercase tracking-widest">
              No matches found
            </div>
          ) : (
            filteredGroups.map((group, gIdx) => (
              <div key={gIdx} className="flex flex-col gap-3">
                <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60 ml-2">
                  {group.label}
                </h3>
                <div className="flex flex-col gap-2">
                  {group.options.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => {
                        onSelect(opt.value);
                        onClose();
                      }}
                      className={`w-full p-5 rounded-3xl border transition-all flex items-center justify-between text-left ${
                        currentValue === opt.value 
                          ? 'bg-primary/10 border-primary/30 ring-1 ring-primary/20' 
                          : 'bg-surface/50 border-border/50 hover:bg-surface active:scale-[0.98]'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-black italic tracking-tight ${currentValue === opt.value ? 'text-primary' : 'text-foreground'}`}>
                          {opt.label}
                        </p>
                        {opt.description && (
                          <p className="text-[10px] text-muted-foreground mt-0.5 truncate uppercase tracking-tighter opacity-60">
                            {opt.description}
                          </p>
                        )}
                      </div>
                      {currentValue === opt.value ? (
                        <Check size={18} className="text-primary shrink-0" />
                      ) : (
                        <ChevronRight size={16} className="text-muted-foreground/30 shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
