import { Plus, MessageSquare, Trash2, Edit2, Check } from 'lucide-react';
import { useState } from 'react';

export interface Conversation {
  id: string;
  title: string;
  created_at: number;
}

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, newTitle: string) => void;
}

export function ConversationSidebar({ conversations, activeId, onSelect, onNew, onDelete, onRename }: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const handleStartRename = (e: React.MouseEvent, id: string, title: string) => {
    e.stopPropagation();
    setEditingId(id);
    setEditValue(title);
  };

  const handleRename = (id: string) => {
    if (editValue.trim()) {
      onRename(id, editValue.trim());
    }
    setEditingId(null);
  };

  return (
    <div className="w-64 border-r border-border bg-surface/50 backdrop-blur-xl flex flex-col h-full shrink-0">
      <div className="p-4 border-b border-border">
        <button 
          onClick={onNew}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 rounded-xl text-sm font-semibold transition-all active:scale-95 shadow-sm shadow-primary/5"
        >
          <Plus className="w-4 h-4" />
          New Conversation
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-4 space-y-1">
        {conversations.length === 0 && (
          <div className="text-center py-8 text-muted-foreground/30 flex flex-col items-center gap-2">
            <MessageSquare className="w-8 h-8 opacity-20" />
            <p className="text-xs uppercase tracking-widest font-bold">No history yet</p>
          </div>
        )}

        {conversations.map((conv) => (
          <div
            key={conv.id}
            onClick={() => onSelect(conv.id)}
            className={`group relative flex items-center gap-3 px-3 py-3 rounded-xl cursor-pointer transition-all border ${
              activeId === conv.id 
                ? 'bg-primary/10 border-primary/30 text-primary shadow-[0_0_15px_rgba(59,130,246,0.05)]' 
                : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground border-transparent'
            }`}
          >
            <MessageSquare className={`w-4 h-4 shrink-0 ${activeId === conv.id ? 'opacity-100' : 'opacity-40 group-hover:opacity-100'}`} />
            
            {editingId === conv.id ? (
              <div className="flex-1 flex items-center gap-1" onClick={e => e.stopPropagation()}>
                <input 
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleRename(conv.id)}
                  className="w-full bg-background border border-primary/50 rounded px-1.5 py-0.5 text-xs outline-none focus:ring-1 focus:ring-primary/50"
                />
                <button onClick={() => handleRename(conv.id)} className="text-primary hover:scale-110 transition-transform">
                  <Check className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <span className="flex-1 text-sm font-medium truncate pr-4">
                {conv.title || 'New Chat'}
              </span>
            )}

            {!editingId && (
              <div className="absolute right-2 opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
                <button 
                  onClick={(e) => handleStartRename(e, conv.id, conv.title)}
                  className="p-1 hover:bg-background rounded-md transition-colors"
                >
                  <Edit2 className="w-3 h-3 text-muted-foreground" />
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); onDelete(conv.id); }}
                  className="p-1 hover:bg-error/10 hover:text-error rounded-md transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
