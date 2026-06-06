import { FileText, Brain, Lightbulb, Database, Trash2, Target } from 'lucide-react';

interface EntityCardProps {
  node: any;
  onDelete?: (id: string) => void;
  onFocus?: (id: string) => void;
}

export const DocumentCard = ({ node, onDelete, onFocus }: EntityCardProps) => (
  <div className="flex flex-col gap-4 animate-in slide-in-from-right-4 duration-300">
    <div className="flex items-center gap-3 p-3 bg-success/10 border border-success/20 rounded-xl">
      <FileText className="w-8 h-8 text-success" />
      <div>
        <div className="text-[10px] font-bold text-success uppercase tracking-widest">Document Node</div>
        <div className="text-sm font-bold truncate w-48">{node.title || 'Untitled Document'}</div>
      </div>
    </div>
    
    <div className="space-y-3">
      <Property label="Source Path" value={node.source} isCode />
      <div className="grid grid-cols-2 gap-2">
        <Property label="Mime Type" value={node.mimeType || 'unknown'} />
        <Property label="Chunks" value={node.chunkCount?.toString() || '0'} />
      </div>
      <Property label="Character Count" value={node.charCount?.toLocaleString() || '0'} />
    </div>

    <Actions node={node} onDelete={onDelete} onFocus={onFocus} />
  </div>
);

export const ConceptCard = ({ node, onDelete, onFocus }: EntityCardProps) => (
  <div className="flex flex-col gap-4 animate-in slide-in-from-right-4 duration-300">
    <div className="flex items-center gap-3 p-3 bg-primary/10 border border-primary/20 rounded-xl">
      <Database className="w-8 h-8 text-primary" />
      <div>
        <div className="text-[10px] font-bold text-primary uppercase tracking-widest">Neural Concept</div>
        <div className="text-sm font-bold">{node.name || 'Anonymous Concept'}</div>
      </div>
    </div>

    <div className="space-y-3">
      <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-1">Description</div>
      <div className="text-sm leading-relaxed p-3 bg-surface rounded-xl border border-border">
        {node.description || 'No neural description available for this concept.'}
      </div>
    </div>

    <Actions node={node} onDelete={onDelete} onFocus={onFocus} />
  </div>
);

export const MemoryCard = ({ node, onDelete, onFocus }: EntityCardProps) => (
  <div className="flex flex-col gap-4 animate-in slide-in-from-right-4 duration-300">
    <div className="flex items-center gap-3 p-3 bg-warning/10 border border-warning/20 rounded-xl">
      <Brain className="w-8 h-8 text-warning" />
      <div>
        <div className="text-[10px] font-bold text-warning uppercase tracking-widest">Procedural Memory</div>
        <div className="text-sm font-bold">{node.category || 'General'}</div>
      </div>
    </div>

    <div className="space-y-3">
      <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-1">Content</div>
      <div className="text-sm leading-relaxed p-3 bg-surface rounded-xl border border-border">
        {node.content || 'Memory trace empty.'}
      </div>
      {node.source && (
        <Property label="Origin" value={node.source} />
      )}
    </div>

    <Actions node={node} onDelete={onDelete} onFocus={onFocus} />
  </div>
);

export const InsightCard = ({ node, onDelete, onFocus }: EntityCardProps) => (
  <div className="flex flex-col gap-4 animate-in slide-in-from-right-4 duration-300">
    <div className="flex items-center gap-3 p-3 bg-purple-500/10 border border-purple-500/20 rounded-xl">
      <Lightbulb className="w-8 h-8 text-purple-500" />
      <div>
        <div className="text-[10px] font-bold text-purple-500 uppercase tracking-widest">AI Insight</div>
        <div className="text-sm font-bold">Inferred Relation</div>
      </div>
    </div>

    <div className="space-y-3">
      <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-1">Synthesized Fact</div>
      <div className="text-sm leading-relaxed bg-surface p-3 rounded-xl border border-border italic text-primary/90">
        "{node.content}"
      </div>
    </div>

    <Actions node={node} onDelete={onDelete} onFocus={onFocus} />
  </div>
);

const Property = ({ label, value, isCode }: { label: string; value: string; isCode?: boolean }) => (
  <div>
    <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mb-1">{label}</div>
    <div className={`text-xs ${isCode ? 'font-mono bg-background p-1.5 rounded border border-border overflow-x-auto truncate' : 'font-medium'}`}>
      {value}
    </div>
  </div>
);

const Actions = ({ node, onDelete, onFocus }: { node: any; onDelete?: (id: string) => void; onFocus?: (id: string) => void }) => (
  <div className="flex items-center gap-2 mt-4 pt-4 border-t border-border">
    <button 
      onClick={() => onFocus?.(node.id)}
      className="flex-1 flex items-center justify-center gap-2 p-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg transition-all text-xs font-bold"
    >
      <Target className="w-3.5 h-3.5" />
      Focus Center
    </button>
    <button 
      onClick={() => onDelete?.(node.id)}
      className="p-2 bg-destructive/10 hover:bg-destructive/20 text-destructive rounded-lg transition-all"
      title="Permanently remove node"
    >
      <Trash2 className="w-3.5 h-3.5" />
    </button>
  </div>
);
