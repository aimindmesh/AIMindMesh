import { useState } from 'react';
import { GripVertical, ChevronUp, ChevronDown, Network } from 'lucide-react';

interface TaskPriorityManagerProps {
  priorities: Record<string, string[]>;
  onChange: (newPriorities: Record<string, string[]>) => void;
  availableNodes: { id: string; name?: string }[];
}

export function TaskPriorityManager({ priorities, onChange, availableNodes }: TaskPriorityManagerProps) {
  const [expandedTask, setExpandedTask] = useState<string | null>(null);

  const taskTypes = [
    'INTENT_CLASSIFICATION', 'QUERY_EXPANSION', 'CONCEPT_EXTRACTION', 'CONCEPT_ENRICHMENT', 
    'IMPROVEMENT_DETECTION', 'PROACTIVE_INSIGHT', 'DEBATE_PARTICIPATION', 'DEBATE_SUMMARY', 
    'INSIGHT_DEDUP', 'WIKI_SYNTHESIS', 'WIKI_TOPIC_MAP', 'EVOLUTION', 'CODE_EVOLUTION', 
    'EVOLUTION_VALIDATION', 'EMBEDDING_GENERATION', 'GENERAL_CHAT', 'WEB_RESEARCH', 'AGENTIC_TASK', 'SCHEDULED_TASK'
  ];

  // Helper to ensure all task types have a list, and all lists have valid nodes
  const getListForTask = (task: string) => {
    const list = priorities?.[task] || [];
    // Ensure default cloud nodes are in the list if missing
    const fullList = Array.from(new Set([...list, 'GEMINI', 'OPENROUTER', 'FREELLMAPI', 'SERVER_LOCAL', ...availableNodes.map(n => n.id)]));
    return fullList;
  };

  const moveNode = (task: string, index: number, direction: 'up' | 'down') => {
    const list = getListForTask(task);
    if (direction === 'up' && index > 0) {
      const temp = list[index];
      list[index] = list[index - 1];
      list[index - 1] = temp;
    } else if (direction === 'down' && index < list.length - 1) {
      const temp = list[index];
      list[index] = list[index + 1];
      list[index + 1] = temp;
    } else {
      return;
    }
    
    onChange({ ...priorities, [task]: list });
  };

  const getNodeName = (id: string) => {
    if (id === 'GEMINI') return 'Google Gemini';
    if (id === 'OPENROUTER') return 'OpenRouter';
    if (id === 'FREELLMAPI') return 'FreeLLMAPI (Proxy Gateway)';
    if (id === 'SERVER_LOCAL') return 'Neural Core (Server)';
    const node = availableNodes.find(n => n.id === id);
    return node?.name || id;
  };

  return (
    <div className="glass-panel p-8 rounded-[48px] border-primary/20 flex flex-col gap-6 w-full">
      <div className="flex items-center gap-4">
        <div className="p-4 bg-primary/10 rounded-3xl text-primary shadow-lg shadow-primary/5">
          <Network size={24} />
        </div>
        <div>
          <h4 className="font-black text-lg tracking-tight uppercase italic underline decoration-primary/40 decoration-4 underline-offset-8">
            Task Routing Priorities
          </h4>
          <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest mt-2 opacity-60 italic">
            Configure target fallbacks for each AI task type
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4 mt-4">
        {taskTypes.map(task => (
          <div key={task} className="border border-border/50 rounded-2xl overflow-hidden">
            <div 
              className="bg-surface p-4 flex justify-between items-center cursor-pointer hover:bg-surface-hover transition-colors"
              onClick={() => setExpandedTask(expandedTask === task ? null : task)}
            >
              <div className="flex items-center gap-4">
                <span className="font-black italic uppercase tracking-widest text-sm text-primary">{task}</span>
                <span className="text-[10px] font-bold text-muted-foreground uppercase opacity-60">
                   {getListForTask(task).slice(0, 3).map(id => getNodeName(id)).join(' → ')} ...
                </span>
              </div>
              {expandedTask === task ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </div>
            {expandedTask === task && (
              <div className="bg-background p-4 flex flex-col gap-2">
                {getListForTask(task).map((nodeId, idx) => (
                  <div key={nodeId} className="flex items-center gap-3 bg-surface border border-border/40 p-3 rounded-xl shadow-inner">
                    <div className="text-muted-foreground opacity-50"><GripVertical size={16} /></div>
                    <span className={`font-black font-mono text-[11px] ${idx === 0 ? 'text-success' : 'opacity-40'}`}>{idx + 1}.</span>
                    <span className="flex-1 font-bold text-sm tracking-tight">{getNodeName(nodeId)}</span>
                    <div className="flex gap-1">
                      <button 
                        onClick={(e) => { e.stopPropagation(); moveNode(task, idx, 'up'); }}
                        disabled={idx === 0}
                        className="p-1.5 hover:bg-surface-hover rounded border border-transparent hover:border-border disabled:opacity-30 transition-colors"
                      >
                        <ChevronUp size={16} />
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); moveNode(task, idx, 'down'); }}
                        disabled={idx === getListForTask(task).length - 1}
                        className="p-1.5 hover:bg-surface-hover rounded border border-transparent hover:border-border disabled:opacity-30 transition-colors"
                      >
                        <ChevronDown size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
