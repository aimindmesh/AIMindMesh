import { useState } from 'react';
import { GripVertical, ChevronUp, ChevronDown, Network } from 'lucide-react';
import { CLAUDE_EXCLUDED_TASKS } from './claude/claudeOptions';

interface TaskPriorityManagerProps {
  priorities: Record<string, string[]>;
  /** List each task type really uses on the server (its own, its category's or the default, with Claude placed) */
  effectivePriorities?: Record<string, string[]>;
  onChange: (newPriorities: Record<string, string[]>) => void;
  availableNodes: { id: string; name?: string | null }[];
}

export function TaskPriorityManager({ priorities, effectivePriorities = {}, onChange, availableNodes }: TaskPriorityManagerProps) {
  const [expandedTask, setExpandedTask] = useState<string | null>(null);

  const taskTypes = [
    'INTENT_CLASSIFICATION', 'QUERY_EXPANSION', 'CONCEPT_EXTRACTION', 'CONCEPT_ENRICHMENT', 
    'IMPROVEMENT_DETECTION', 'PROACTIVE_INSIGHT', 'DEBATE_PARTICIPATION', 'DEBATE_SUMMARY', 
    'INSIGHT_DEDUP', 'WIKI_SYNTHESIS', 'WIKI_TOPIC_MAP', 'EVOLUTION', 'CODE_EVOLUTION', 
    'EVOLUTION_VALIDATION', 'EMBEDDING_GENERATION', 'GENERAL_CHAT', 'WEB_RESEARCH', 'AGENTIC_TASK', 'SCHEDULED_TASK',
    'DIRECTIVES_EXTRACTION', 'ORGANIZATION_DESIGN'
  ];

  const getListForTask = (task: string) => {
    // A list without Claude is completed by the server (Claude first in its categories): show the
    // list the server really uses, so a saved edit keeps Claude where it is
    const own = priorities?.[task];
    const list = (own?.includes('CLAUDE') ? own : effectivePriorities[task] || own) || [];
    const excluded = CLAUDE_EXCLUDED_TASKS.includes(task);
    const fullList = Array.from(new Set([...list, ...(excluded ? [] : ['CLAUDE']), 'GEMINI', 'OPENROUTER', 'FREELLMAPI', 'SERVER_LOCAL', ...availableNodes.map(n => n.id)]));
    return excluded ? fullList.filter(id => id !== 'CLAUDE') : fullList;
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
    if (id === 'GEMINI') return 'Gemini Cloud';
    if (id === 'OPENROUTER') return 'OpenRouter';
    if (id === 'FREELLMAPI') return 'FreeLLMAPI Proxy';
    if (id === 'CLAUDE') return 'Anthropic Claude';
    if (id === 'SERVER_LOCAL') return 'Neural Core';
    const node = availableNodes.find(n => n.id === id);
    return node?.name || id;
  };

  return (
    <div className="glass-panel rounded-3xl p-5 mb-4">
      <div className="flex items-center gap-3 mb-5">
        <div className="p-2.5 bg-primary/10 rounded-2xl text-primary">
          <Network size={18} />
        </div>
        <div>
          <h2 className="text-xs font-black uppercase tracking-[0.3em] text-foreground">Task Priorities</h2>
          <p className="text-[9px] text-muted-foreground font-bold uppercase tracking-widest mt-0.5 opacity-60 italic">Fallback chains by type</p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {taskTypes.map(task => (
          <div key={task} className="border border-border/30 rounded-2xl overflow-hidden bg-surface/30">
            <div 
              className="p-4 flex justify-between items-center active:bg-surface/50 transition-colors"
              onClick={() => setExpandedTask(expandedTask === task ? null : task)}
            >
              <div className="flex flex-col">
                <span className="font-black italic uppercase tracking-widest text-[11px] text-primary">{task}</span>
                <span className="text-[8px] font-bold text-muted-foreground uppercase opacity-60 mt-1 truncate max-w-[200px]">
                   {getListForTask(task).slice(0, 2).map(id => getNodeName(id)).join(' → ')} ...
                </span>
              </div>
              {expandedTask === task ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>
            
            {expandedTask === task && (
              <div className="bg-background/40 p-3 flex flex-col gap-2 border-t border-border/20">
                {getListForTask(task).map((nodeId, idx) => (
                  <div key={nodeId} className="flex items-center gap-3 bg-surface/50 border border-border/20 p-3 rounded-xl shadow-sm">
                    <div className="text-muted-foreground opacity-30"><GripVertical size={14} /></div>
                    <span className={`font-black font-mono text-[10px] ${idx === 0 ? 'text-success' : 'opacity-40'}`}>{idx + 1}.</span>
                    <span className="flex-1 font-bold text-[11px] tracking-tight truncate">{getNodeName(nodeId)}</span>
                    <div className="flex gap-1">
                      <button 
                        onClick={(e) => { e.stopPropagation(); moveNode(task, idx, 'up'); }}
                        disabled={idx === 0}
                        className="p-1.5 bg-surface rounded-lg border border-border/30 disabled:opacity-20 active:scale-90 transition-all"
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); moveNode(task, idx, 'down'); }}
                        disabled={idx === getListForTask(task).length - 1}
                        className="p-1.5 bg-surface rounded-lg border border-border/30 disabled:opacity-20 active:scale-90 transition-all"
                      >
                        <ChevronDown size={14} />
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
