import { useState, useEffect, useRef } from 'react';
import { Send, Bot, User, AlertCircle, Cpu, BrainCircuit, Loader2, Trash2, Globe } from 'lucide-react';
import { useSocket } from '../components/SocketContext';
import { useConfigStore } from '../store/configStore';
import { useUIStore } from '../store/uiStore';
import { ConversationSidebar, Conversation } from '../components/chat/ConversationSidebar';
import { Logger } from '../utils/logger';
import { formatAiMessage } from '../utils/formatters';
import { adminApi } from '../services/serverApi';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
  isStreaming?: boolean;
  usedNode?: string;
  timestamp?: number;
}

export default function ChatView() {
  const config = useConfigStore(state => state.config);
  const discussionContext = useUIStore(state => state.discussionContext);
  const clearDiscussion = useUIStore(state => state.clearDiscussion);
  const performanceMode = useUIStore(state => state.performanceMode);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [thinkingMode, setThinkingMode] = useState(false);
  const [routingMode, setRoutingMode] = useState<string>(
    config?.ollama?.preferred_routing || 'auto'
  );
  const [availableNodes, setAvailableNodes] = useState<Array<{id: string, type: string, status: string, name?: string}>>([]);
  const [searchMode, setSearchMode] = useState(config?.ui?.search_enabled ?? false);

  useEffect(() => {
    if (config?.ollama?.preferred_routing) {
      setRoutingMode(config.ollama.preferred_routing as 'auto' | 'laptop' | 'server' | 'gemini' | 'openrouter');
    }
  }, [config?.ollama?.preferred_routing]);

  useEffect(() => {
    if (discussionContext) {
      setInput(discussionContext);
      // Use setImmediate or setTimeout to ensure clearDiscussion doesn't trigger loop
      const t = setTimeout(() => clearDiscussion(), 0);
      return () => clearTimeout(t);
    }
  }, [discussionContext, clearDiscussion]);

  useEffect(() => {
    const fetchNodes = async () => {
      try {
        const res = await adminApi.getNodes();
        setAvailableNodes(res.data.nodes || []);
      } catch (err) {
        Logger.error('ChatView', 'Failed to fetch mesh nodes');
      }
    };
    fetchNodes();
    const interval = setInterval(fetchNodes, 15000);
    return () => clearInterval(interval);
  }, []);

  const { isConnected: socketConnected, subscribe, send } = useSocket();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const getNodeName = (nodeId: string) => {
    const node = availableNodes.find(n => n.id.toUpperCase() === nodeId.toUpperCase());
    return node?.name || nodeId;
  };

  const formatTime = (ts?: number) => {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  useEffect(() => {
    setIsConnected(socketConnected);
  }, [socketConnected]);

  useEffect(() => {
    const unsubscribe = subscribe((data) => {
      Logger.debug('ChatView', `Incoming neural signature: ${data.type}`, data);

      if (data.type === 'conversations') {
        setConversations(data.conversations || []);
      } else if (data.type === 'history') {
        setActiveConversationId(data.conversationId);
        const historyMsgs = (data.messages || []).map((m: any) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant' | 'error',
          content: m.content,
          usedNode: m.used_node,
          timestamp: m.timestamp
        }));
        setMessages(historyMsgs);
       } else if (data.type === 'delta' || data.type === 'thought') {
         setIsProcessing(false);
         const content = data.type === 'thought' ? `<think>${data.content}</think>` : data.content;
 
         setMessages(prev => {
           const newMsgs = [...prev];
           const lastMsg = newMsgs[newMsgs.length - 1];
           if (lastMsg && lastMsg.role === 'assistant' && lastMsg.isStreaming) {
             lastMsg.content += content;
           } else {
             newMsgs.push({ 
               id: Date.now().toString(), 
               role: 'assistant', 
               content: content || '', 
               isStreaming: true,
               timestamp: Date.now()
             });
           }
           return newMsgs;
         });
      } else if (data.type === 'done') {
        setIsProcessing(false);
        setMessages(prev => {
          const newMsgs = [...prev];
          const lastMsg = newMsgs[newMsgs.length - 1];
          if (lastMsg && lastMsg.role === 'assistant') {
            lastMsg.isStreaming = false;
            lastMsg.usedNode = data.usedNode;
          }
          return newMsgs;
        });
      } else if (data.type === 'error') {
        Logger.error('ChatView', `Neural link failure: ${data.message}`);
        setIsProcessing(false);
        setMessages(prev => [...prev, { 
          id: Date.now().toString(), 
          role: 'error', 
          content: data.message,
          timestamp: Date.now()
        }]);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [subscribe]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim()) return;
    Logger.info('ChatView', `Forwarding synaptic pulse to server: ${input.substring(0, 30)}...`);
    
    // Optimistic Update
    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: Date.now()
    };
    setMessages(prev => [...prev, userMsg]);
    
    setIsProcessing(true);
    send({
      type: 'message',
      content: input,
      options: { thinking: thinkingMode, routing: routingMode.toUpperCase(), searchEnabled: searchMode }
    });
    setInput('');
  };

  const handleNewConversation = () => {
    send({ type: 'new_conversation' });
  };

  const handleSelectConversation = (id: string) => {
    send({ type: 'select_conversation', conversationId: id });
  };

  const handleDeleteConversation = (id: string) => {
    send({ type: 'delete_conversation', conversationId: id });
  };

  const handleRenameConversation = (id: string, title: string) => {
    send({ type: 'rename_conversation', conversationId: id, title });
  };

  const handleClearMessages = () => {
    send({ type: 'clear' });
    setMessages([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!config) {
    return (
      <div className="p-6 h-full flex flex-col items-center justify-center gap-4 animate-fade-in text-muted-foreground">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="font-semibold">Establishing Secure Link...</p>
      </div>
    );
  }

  return (
    <div className="h-full flex overflow-hidden">
      {/* Conversation Sidebar */}
      <ConversationSidebar
        conversations={conversations}
        activeId={activeConversationId}
        onSelect={handleSelectConversation}
        onNew={handleNewConversation}
        onDelete={handleDeleteConversation}
        onRename={handleRenameConversation}
      />

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col overflow-hidden p-4 gap-3">
        {/* Header */}
        <div className="flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-2xl font-black italic tracking-tighter uppercase">Direct Chat</h1>
            <div className="flex items-center gap-2.5 mt-1 transition-all">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'status-dot-online' : 'status-dot-offline'}`} />
              <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${isConnected ? 'text-success' : 'text-error'}`}>
                {isConnected ? 'Neural Link Active' : 'Establishing Secure Link...'}
              </span>
              {performanceMode && (
                <span className="ml-3 px-2 py-0.5 bg-yellow-500/20 border border-yellow-500/30 text-yellow-500 text-[9px] font-black uppercase tracking-widest rounded-md animate-pulse">
                  Perf-Mode Active
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleClearMessages}
              className="p-2 text-muted-foreground hover:bg-red-500/10 hover:text-red-400 rounded-xl transition-all"
              title="Clear current conversation messages"
            >
              <Trash2 className="w-4 h-4" />
            </button>

            <div className="flex bg-surface-hover/60 p-1.5 rounded-xl border border-border shadow-inner gap-1 overflow-x-auto custom-scrollbar max-w-md">
              {['AUTO', ...availableNodes.map(n => n.id.toUpperCase()), 'GEMINI', 'OPENROUTER'].map(mode => {
                const isMe = mode === config?.node?.id?.toUpperCase();
                const label = isMe ? 'THIS PC' : mode === 'SERVER_LOCAL' ? 'OLLAMA' : getNodeName(mode).toUpperCase();
                return (
                  <button
                    key={mode}
                    onClick={() => setRoutingMode(mode)}
                    className={`px-3 py-1.5 rounded-lg text-[9px] whitespace-nowrap font-black uppercase tracking-widest transition-all ${
                      routingMode === mode ? 'bg-surface shadow-md text-primary border border-primary/20 scale-105' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => setThinkingMode(!thinkingMode)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                thinkingMode ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-transparent border-border/50 text-muted-foreground hover:text-foreground'
              }`}
            >
              <BrainCircuit className={`w-3.5 h-3.5 ${thinkingMode ? 'animate-pulse' : ''}`} />
              THINKING
            </button>

            <button
              onClick={() => setSearchMode(!searchMode)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                searchMode ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-transparent border-border/50 text-muted-foreground hover:text-foreground'
              }`}
              title="Search the web for real-time information"
            >
              <Globe className={`w-3.5 h-3.5 ${searchMode ? 'animate-pulse' : ''}`} />
              SEARCH
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="glass-panel flex-1 rounded-2xl flex flex-col overflow-hidden shadow-2xl border border-white/5">
          <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4 scroll-smooth custom-scrollbar">
            {messages.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground/50 gap-3">
                <Bot className="w-12 h-12 opacity-25" />
                <div className="text-center">
                  <p className="font-semibold text-sm">Intelligence Mesh Ready</p>
                  <p className="text-xs opacity-70 mt-1">Start a conversation or select one from the sidebar.</p>
                </div>
              </div>
            ) : (
              messages.map((msg) => (
                <div key={msg.id} className={`flex gap-3 animate-fade-in ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center shadow ${
                    msg.role === 'user' ? 'bg-primary/25 text-primary border border-primary/30' :
                    msg.role === 'error' ? 'bg-error/20 text-error border border-error/30' : 'bg-surface border border-white/8 text-foreground'
                  }`}>
                    {msg.role === 'user' ? <User size={15} /> : msg.role === 'error' ? <AlertCircle size={15} /> : <Bot size={15} />}
                  </div>

                  <div className={`flex flex-col gap-1 max-w-[78%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <div className={`p-3.5 text-sm leading-relaxed whitespace-pre-wrap ${
                      msg.role === 'user'
                        ? 'chat-bubble-user'
                        : msg.role === 'error'
                          ? 'bg-error/90 text-white rounded-2xl rounded-tl-sm shadow-lg'
                          : 'chat-bubble-ai text-foreground'
                    }`}>
                      {formatAiMessage(msg.content)}
                      {msg.isStreaming && <span className="inline-block w-2 h-3.5 ml-1 bg-current animate-pulse rounded-sm align-middle opacity-70" />}
                    </div>
                    {msg.usedNode && !msg.isStreaming && (
                      <div className="text-[10px] uppercase font-bold text-muted-foreground/50 flex items-center gap-2 px-1">
                        <span className="flex items-center gap-1"><Cpu size={9} /> {getNodeName(msg.usedNode)}</span>
                        {msg.timestamp && <span className="opacity-60">{formatTime(msg.timestamp)}</span>}
                      </div>
                    )}
                    {!msg.usedNode && msg.timestamp && (
                      <div className="text-[10px] uppercase font-bold text-muted-foreground/40 px-1">
                         {formatTime(msg.timestamp)}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
            {isProcessing && (
              <div className="flex gap-3 animate-fade-in flex-row">
                <div className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center shadow bg-surface border border-white/8 text-primary">
                  <BrainCircuit size={15} className="animate-pulse" />
                </div>
                <div className="flex flex-col gap-1 items-start">
                  <div className="p-3.5 text-sm leading-relaxed chat-bubble-ai text-muted-foreground flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" />
                    Neural link processing...
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="p-3 border-t border-white/5 bg-black/15 backdrop-blur-lg">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything..."
                className="flex-1 bg-input border border-border focus:border-primary/50 focus:ring-1 focus:ring-primary/20 p-3.5 rounded-xl outline-none resize-none min-h-[50px] max-h-36 overflow-y-auto w-full transition-all text-sm text-foreground placeholder:text-muted-foreground"
                rows={1}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || !isConnected}
                className="bg-primary hover:bg-primary-hover active:scale-95 disabled:opacity-40 text-white p-3.5 rounded-xl flex items-center justify-center transition-all shadow-lg shadow-primary/20 group shrink-0"
              >
                <Send className="w-4 h-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
