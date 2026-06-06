import { useEffect, useState, useMemo } from 'react';

import { serverApi } from '../services/serverApi';
import { Mail, MailOpen, AlertCircle, ChevronRight, Hash, Clock, BrainCircuit, Activity, Send, Lock, Unlock, RefreshCw } from 'lucide-react';
import { Logger } from '../utils/logger';

// Correggiamo l'import
import { useFeedStore as storeFunc } from '../store/feedStore';

import { formatAiMessage } from '../utils/formatters';
import { useConfigStore } from '../store/configStore';
import { formatThreadAsMarkdown } from '../utils/debateExport';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';

interface FeedItem {
  id: string;
  type: string;
  content: string;
  source_node_ids?: string;
  created_at: number;
  read_at: number | null;
}

export default function FeedView() {
  const { insights, setInsights, markAsRead } = storeFunc();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeDebateId, setActiveDebateId] = useState<string | null>(null);
  const [debateData, setDebateData] = useState<any>(null);
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);
  const [expandedInsights, setExpandedInsights] = useState<Set<string>>(new Set());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedInsights(prev => {
       const next = new Set(prev);
       if (next.has(id)) next.delete(id);
       else next.add(id);
       return next;
    });
  };

  const fetchFeed = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await serverApi.get('/api/feed?limit=20');
      // Adattiamo i feedItem allo store (l'API server potrebbe avere chiavi leggermente diverse dallo state originario mock, le uniformiamo)
      const mapped = (res.data.items || []).map((item: FeedItem) => ({
        id: item.id,
        text: item.content,
        timestamp: item.created_at,
        concepts: item.source_node_ids ? JSON.parse(item.source_node_ids) : [],
        unread: item.read_at === null
      }));
      Logger.debug('FeedView', `Transformed ${mapped.length} synaptic insights for storage`);
      setInsights(mapped);
    } catch (err: any) {
      Logger.error('FeedView', 'Feed synchronization failed', err);
      setError(err.message || 'Error fetching feed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFeed();
  }, []);

  const handleMarkRead = async (id: string, currentlyUnread: boolean) => {
    if (!currentlyUnread) {
      Logger.debug('FeedView', `Insight ${id} already processed (read)`);
      return;
    }
    try {
      await serverApi.post(`/api/feed/${id}/read`);
      markAsRead(id);
      Logger.info('FeedView', `Insight ${id} marked as interpreted`);
    } catch (err) {
      Logger.error('FeedView', `Failed to mark insight ${id} as interpreted`, err);
    }
  };

  const openDebate = async (id: string, unread: boolean) => {
    handleMarkRead(id, unread);
    if (activeDebateId === id) {
       setActiveDebateId(null);
       return;
    }
    setActiveDebateId(id);
    setDebateData(null);
    try {
      const res = await serverApi.get(`/api/feed/${id}/debate`);
      setDebateData(res.data);
    } catch (e) {
       Logger.error('FeedView', 'Failed to fetch debate', e);
    }
  };

  const sendReply = async (id: string) => {
    if(!replyText.trim() || replying) return;
    const serverUrl = useConfigStore.getState().config?.server?.url?.replace(/\/$/, '');
    const apiKey = useConfigStore.getState().config?.server?.api_key;
    
    if (!serverUrl) {
      Logger.error('FeedView', 'Server URL not configured');
      return;
    }

    const currentText = replyText;
    setReplyText('');
    setReplying(true);

    try {
      const response = await fetch(`${serverUrl}/api/feed/${id}/reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey || ''
        },
        body: JSON.stringify({ content: currentText })
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const reader = response.body?.getReader();
      if (!reader) throw new Error('ReadableStream not supported');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const payload = JSON.parse(line);
            
            if (payload.type === 'user_reply' && payload.reply) {
               // Update local state with the user message immediately
               setDebateData((prev: any) => ({
                 ...prev,
                 messages: [...(prev?.messages || []), {
                   id: payload.reply.id,
                   author: 'HUMAN',
                   content: payload.reply.content,
                   round: prev?.thread?.current_round || 1
                 }]
               }));
            }

            if (payload.type === 'agent_reply' && payload.message) {
              setDebateData((prev: any) => ({
                ...prev,
                messages: [...(prev?.messages || []), {
                  id: payload.message.id,
                  author: payload.message.author,
                  content: payload.message.content,
                  round: payload.message.round
                }]
              }));
            }
          } catch (e) {
            // Partial JSON
          }
        }
      }
    } catch (e: any) {
       Logger.error('FeedView', 'Reply streaming failed', e);
       setError('Failed to send reply or stream response');
    } finally {
       setReplying(false);
    }
  };

  const handleToggleStatus = async (id: string) => {
    if (!debateData?.thread) return;
    const currentStatus = debateData.thread.status || 'ACTIVE';
    const newStatus = currentStatus === 'ACTIVE' ? 'CLOSED' : 'ACTIVE';
    
    try {
      await serverApi.post(`/api/feed/${id}/debate/status`, { status: newStatus });
      setDebateData((prev: any) => ({
        ...prev,
        thread: { ...prev.thread, status: newStatus }
      }));
      Logger.info('FeedView', `Thread status updated to ${newStatus}`);
    } catch (err) {
      Logger.error('FeedView', 'Failed to toggle thread status', err);
    }
  };

  const handleExportClipboard = async (insightContent: string) => {
    if (!debateData?.messages) return;
    const markdown = formatThreadAsMarkdown(insightContent, debateData.messages);
    await writeText(markdown);
    Logger.info('FeedView', 'Thread copied to clipboard');
  };

  const handleExportFile = async (insightContent: string) => {
    if (!debateData?.messages) return;
    try {
      const markdown = formatThreadAsMarkdown(insightContent, debateData.messages);
      const defaultPath = `debate_${activeDebateId?.substring(0, 8)}.md`;
      
      const filePath = await save({
        defaultPath,
        filters: [{
          name: 'Markdown',
          extensions: ['md']
        }]
      });

      if (filePath) {
        await writeTextFile(filePath, markdown);
        Logger.info('FeedView', `Thread saved to ${filePath}`);
      }
    } catch (e) {
      Logger.error('FeedView', 'Failed to export debate file', e);
    }
  };

  const handleReprocess = async (insightId: string) => {
    try {
      await serverApi.post(`/api/admin/debate/reprocess/${insightId}`);
      Logger.info('FeedView', `Reprocess triggered for ${insightId}`);
      // Refresh debate data
      setDebateData(null);
      setTimeout(() => openDebate(insightId, false), 500);
    } catch (err) {
      Logger.error('FeedView', 'Failed to trigger reprocess', err);
    }
  };

  const groupedInsights = useMemo(() => {
    const groups: Record<string, typeof insights> = {};
    const sorted = [...insights].sort((a, b) => b.timestamp - a.timestamp);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    sorted.forEach(insight => {
      const d = new Date(insight.timestamp);
      d.setHours(0, 0, 0, 0);
      
      let label = '';
      if (d.getTime() === today.getTime()) {
        label = 'Today';
      } else if (d.getTime() === yesterday.getTime()) {
        label = 'Yesterday';
      } else {
        label = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      }
      
      if (!groups[label]) groups[label] = [];
      groups[label].push(insight);
    });
    
    return groups;
  }, [insights]);

  useEffect(() => {
    const keys = Object.keys(groupedInsights);
    if (keys.length > 0 && (!selectedDate || !keys.includes(selectedDate))) {
      setSelectedDate(keys[0]);
    }
  }, [groupedInsights, selectedDate]);

  return (
    <div className="absolute inset-0 p-6 flex flex-col gap-6 animate-fade-in max-w-5xl mx-auto w-full overflow-hidden">
      <div className="flex items-center justify-between shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">AI Insights Feed</h1>
        <button 
          onClick={fetchFeed} 
          disabled={loading}
          className="text-sm font-medium px-4 py-2 rounded-xl bg-surface border border-border hover:bg-surface-hover transition-colors"
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error ? (
        <div className="glass-panel p-6 rounded-2xl flex items-center gap-4 text-error border-error/50 bg-error/10">
          <AlertCircle size={24} />
          <p className="font-medium">{error}</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex gap-6">
          {insights.length === 0 && !loading ? (
            <div className="glass-panel flex-1 rounded-2xl p-12 flex flex-col items-center justify-center text-muted-foreground text-center h-fit">
              <MailOpen className="w-16 h-16 opacity-50 mb-4" />
              <h3 className="text-xl font-semibold mb-2 text-foreground">All caught up</h3>
              <p className="max-w-md opacity-80">The proactive engine is analyzing your knowledge graph. New insights will appear here automatically.</p>
            </div>
          ) : (
            <>
              {Object.keys(groupedInsights).length > 0 && (
                <div className="w-56 shrink-0 overflow-y-auto pr-2 custom-scrollbar pb-6 space-y-2">
                  {Object.keys(groupedInsights).map(dateLabel => (
                    <button
                      key={dateLabel}
                      onClick={() => setSelectedDate(dateLabel)}
                      className={`w-full block text-left px-4 py-3 rounded-xl text-sm font-bold transition-all ${
                        selectedDate === dateLabel 
                          ? 'bg-primary text-primary-foreground shadow-md' 
                          : 'bg-surface border border-border text-muted-foreground hover:text-foreground hover:bg-surface-hover'
                      }`}
                    >
                      {dateLabel}
                    </button>
                  ))}
                </div>
              )}
              
              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar pb-6 space-y-4 relative">
                {(groupedInsights[selectedDate || ''] || []).map((insight: any) => (
                  <div 
                    key={insight.id} 
                    className={`glass-panel rounded-2xl transition-all duration-300 relative overflow-hidden flex flex-col border border-transparent hover:border-border/50 ${activeDebateId === insight.id ? 'ring-2 ring-primary/20 scale-[1.01]' : ''}`}
                  >
                    <div 
                      onClick={() => openDebate(insight.id, insight.unread)}
                  className={`p-6 cursor-pointer group border-l-4 ${
                    insight.unread ? 'border-l-primary bg-primary/5 shadow-md shadow-primary/5' : 'border-l-transparent hover:bg-surface-hover/30'
                  }`}
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground font-medium">
                      <Clock size={14} />
                      {new Date(insight.timestamp).toLocaleString(undefined, {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                      })}
                    </div>
                    <div className="opacity-50 group-hover:opacity-100 transition-opacity">
                      {insight.unread ? <Mail className="text-primary" size={18} /> : <MailOpen size={18} />}
                    </div>
                  </div>

                  <div className="text-lg font-medium leading-snug mb-2 text-foreground/90">
                    {formatAiMessage(
                       insight.text.length > 800 && !expandedInsights.has(insight.id)
                          ? insight.text.substring(0, 800) + '...'
                          : insight.text
                    )}
                  </div>
                  {insight.text.length > 800 && (
                    <button 
                      onClick={(e) => toggleExpand(insight.id, e)} 
                      className="text-primary text-sm font-bold hover:underline mb-6 text-left block w-fit"
                    >
                      {expandedInsights.has(insight.id) ? 'Show Less' : 'Show More...'}
                    </button>
                  )}
                  {insight.text.length <= 800 && <div className="mb-6" />}

                  <div className="flex items-center justify-between">
                    <div className="flex flex-wrap gap-2">
                      {insight.concepts.slice(0, 3).map((concept: any, idx: number) => (
                        <span key={idx} className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-background border border-border text-xs font-semibold text-muted-foreground">
                          <Hash size={12} className="opacity-70" /> {concept}
                        </span>
                      ))}
                      {insight.concepts.length > 3 && (
                        <span className="inline-flex items-center px-2 py-1 rounded-full bg-background border border-border text-xs font-semibold text-muted-foreground">
                          +{insight.concepts.length - 3}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-primary hover:text-primary-hover transition-colors opacity-80 group-hover:opacity-100">
                      <BrainCircuit size={16} /> Open Debate <ChevronRight size={16} className={`transition-transform ${activeDebateId === insight.id ? 'rotate-90' : ''}`} />
                    </div>
                  </div>
                </div>

                {activeDebateId === insight.id && (
                   <div className="border-t border-border bg-background p-6 flex flex-col gap-4 animate-fade-in">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="font-bold flex items-center gap-2 text-sm text-muted-foreground uppercase tracking-wider">
                          <BrainCircuit size={16} className="text-primary"/> Multi-Agent Thread
                        </h4>
                        <div className="flex items-center gap-2">
                           <button 
                             onClick={() => handleToggleStatus(insight.id)}
                             className={`p-2 rounded-lg border transition-all ${debateData?.thread?.status === 'CLOSED' ? 'bg-error/10 border-error/30 text-error' : 'hover:bg-surface border-border text-muted-foreground hover:text-foreground'}`}
                             title={debateData?.thread?.status === 'ACTIVE' ? 'Lock Discussion' : 'Unlock Discussion'}
                           >
                             {debateData?.thread?.status === 'CLOSED' ? <Lock size={14} /> : <Unlock size={14} />}
                           </button>
                           <button 
                             onClick={() => handleReprocess(insight.id)}
                             className="p-2 rounded-lg hover:bg-surface border border-border transition-all text-muted-foreground hover:text-primary"
                             title="Reprocess Insight (Re-run Agents)"
                           >
                             <RefreshCw size={14} />
                           </button>
                           <button 
                             onClick={() => handleExportClipboard(insight.text)} 
                             className="p-2 rounded-lg hover:bg-surface border border-border transition-all text-muted-foreground hover:text-foreground"
                             title="Copy to Clipboard"
                           >
                             <Send size={14} className="-rotate-90" />
                           </button>
                           <button 
                             onClick={() => handleExportFile(insight.text)} 
                             className="p-2 rounded-lg hover:bg-surface border border-border transition-all text-muted-foreground hover:text-foreground"
                             title="Save as .md"
                           >
                              <MailOpen size={14} />
                           </button>
                        </div>
                      </div>
                      
                      {debateData === null ? (
                        <div className="animate-pulse flex items-center gap-2 text-muted-foreground py-4 text-sm"><Activity size={14} className="animate-spin" /> Loading AI discussion...</div>
                      ) : !debateData.thread ? (
                        <div className="text-muted-foreground text-sm italic py-4 bg-surface rounded-xl px-4 border border-border">Debate thread pending. The Orchestrator will establish this session shortly.</div>
                      ) : (
                        <div className="flex flex-col gap-3">
                           {debateData.messages?.map((msg: any) => (
                              <div key={msg.id} className={`p-4 rounded-2xl text-sm transition-all shadow-sm ${msg.author === 'HUMAN' ? 'bg-primary/10 ml-8 border border-primary/20 text-foreground' : msg.author === 'ORCHESTRATOR' ? 'bg-secondary/10 border-secondary/20 mx-4 font-mono' : 'bg-surface border border-border mr-8'}`}>
                                 <p className={`font-bold text-xs mb-1.5 flex items-center gap-2 uppercase tracking-wide ${msg.author === 'HUMAN' ? 'text-primary' : msg.author === 'ORCHESTRATOR' ? 'text-secondary' : 'text-muted-foreground'}`}>
                                    {msg.author} <span className="px-1.5 py-0.5 rounded-md bg-background border border-border opacity-60 ml-auto">R{msg.round}</span>
                                 </p>
                                 <p className="leading-relaxed opacity-90">{msg.content}</p>
                              </div>
                           ))}
                           <div className="flex items-center gap-2 mt-2 relative w-full pt-4 border-t border-border">
                              <input 
                                value={replyText} 
                                onChange={(e) => setReplyText(e.target.value)} 
                                placeholder={debateData?.thread?.status === 'CLOSED' ? "Discussion locked by user" : "Inject a human argument into the debate..."}
                                onKeyDown={(e) => e.key === 'Enter' && sendReply(insight.id)}
                                disabled={replying || debateData?.thread?.status === 'CLOSED'}
                                className="w-full bg-surface border border-border shadow-inner rounded-xl p-3 pr-12 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all disabled:opacity-50"
                              />
                              <button 
                                onClick={() => sendReply(insight.id)} 
                                disabled={replying || !replyText.trim() || debateData?.thread?.status === 'CLOSED'} 
                                className="absolute right-2 top-[22px] p-2 bg-primary text-white rounded-lg disabled:opacity-50 hover:bg-primary-hover shadow-md transition-all active:scale-90"
                              >
                                 <Send size={16} />
                              </button>
                           </div>
                        </div>
                      )}
                   </div>
                )}
              </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
