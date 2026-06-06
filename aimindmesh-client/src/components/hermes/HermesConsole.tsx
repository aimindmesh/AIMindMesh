import React, { useRef, useState } from 'react';
import { agentApi } from '../../services/serverApi';
import { useHermesStore, HermesMessage } from '../../store/hermesStore';

const SESSIONS = [
  { key: 'system', label: 'System Context' },
  { key: 'chat', label: 'Interactive Chat' },
];

export const HermesConsole: React.FC = () => {
  const { consoleMessages, loading, addConsoleMessage, clearConsole, setLoading } = useHermesStore();
  const [activeSession, setActiveSession] = useState('system');
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const send = async () => {
    if (!input.trim() || loading) return;

    const userMsg: HermesMessage = {
      role: 'user',
      content: input,
      timestamp: new Date().toISOString()
    };

    addConsoleMessage(userMsg);
    setInput('');
    setLoading(true);

    try {
      const { data } = await agentApi.runHermesTask(input, activeSession);
      addConsoleMessage({
        role: 'assistant',
        content: data.reply,
        timestamp: new Date().toISOString(),
      });
    } catch (e: any) {
      addConsoleMessage({
        role: 'assistant',
        content: `⚠️ Error: ${e.response?.data?.error || e.message}`,
        timestamp: new Date().toISOString(),
      });
    } finally {
      setLoading(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  };

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Session selector */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Session Context:</span>
          <select
            value={activeSession}
            onChange={(e) => setActiveSession(e.target.value)}
            className="rounded-md px-3 py-1.5 text-xs font-medium border border-border bg-background hover:bg-surface-offset transition-colors"
          >
            {SESSIONS.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </div>
        <button
          onClick={clearConsole}
          className="text-xs text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1 px-2 py-1 rounded hover:bg-destructive/10"
        >
          Clear Console
        </button>
      </div>

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto rounded-xl p-6 flex flex-col gap-4 border border-border bg-surface/50 backdrop-blur-sm min-h-[300px]"
        style={{ scrollbarWidth: 'thin' }}
      >
        {consoleMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full opacity-40 text-center gap-3">
            <div className="w-12 h-12 rounded-full border-2 border-dashed border-primary/50 flex items-center justify-center">
              <span className="text-xl">🤖</span>
            </div>
            <p className="max-w-xs text-sm leading-relaxed">
              Hermes Agent is ready for agentic execution. Type a complex task below.
            </p>
          </div>
        )}
        {consoleMessages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`rounded-2xl px-4 py-3 max-w-[90%] shadow-sm ${
                msg.role === 'user'
                  ? 'bg-purple-600 text-white rounded-tr-none'
                  : 'bg-surface-2 border border-border rounded-tl-none'
              }`}
            >
              <div className="text-sm prose prose-invert max-w-none break-words whitespace-pre-wrap">
                {msg.content}
              </div>
              <div className={`mt-2 text-[10px] opacity-50 text-right ${msg.role === 'user' ? 'text-purple-200' : 'text-muted-foreground'}`}>
                {new Date(msg.timestamp).toLocaleTimeString()}
              </div>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-surface-2 border border-border rounded-2xl rounded-tl-none px-4 py-3 flex gap-2 items-center">
               <div className="flex gap-1">
                 <span className="w-1.5 h-1.5 bg-purple-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                 <span className="w-1.5 h-1.5 bg-purple-600 rounded-full animate-bounce" style={{ animationDelay: '200ms' }} />
                 <span className="w-1.5 h-1.5 bg-purple-600 rounded-full animate-bounce" style={{ animationDelay: '400ms' }} />
               </div>
               <span className="text-xs text-muted-foreground ml-1">Hermes is executing...</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex gap-3 items-center p-1">
        <div className="flex-1 relative group">
          <textarea
            rows={1}
            className="w-full rounded-xl px-4 py-3.5 bg-surface border border-border focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none transition-all resize-none text-sm pr-12 shadow-sm"
            placeholder="Instruct Hermes Agent (e.g. 'Synthesize open source developments for model extraction')..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            disabled={loading}
          />
        </div>
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          className="rounded-xl px-6 py-3.5 bg-purple-600 text-white font-semibold text-sm shadow-lg shadow-purple-600/20 hover:shadow-purple-600/30 active:scale-95 disabled:opacity-50 disabled:scale-100 transition-all"
        >
          {loading ? 'EXECUTING' : 'EXECUTE'}
        </button>
      </div>
    </div>
  );
};
