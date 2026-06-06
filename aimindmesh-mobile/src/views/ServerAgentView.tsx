import React, { useState, useEffect, useRef } from 'react';
import { AIMindMeshServerSettings } from '../services/llm/providers/serverProvider';
import { logger } from '../services/logger';
import { triggerHaptic } from '../services/native';

interface ServerAgentViewProps {
    settings: AIMindMeshServerSettings;
    /** Explicit provider override from App.tsx (from llmConfig.serverSideAgentProvider) */
    provider?: 'openclaw' | 'hermes';
}

interface AgentMessage {
    role: 'user' | 'assistant' | 'thought';
    content: string;
}

const ServerAgentView: React.FC<ServerAgentViewProps> = ({ settings, provider }) => {
    // Resolve effective provider: prop takes priority, then settings field, then default
    const activeProvider: 'openclaw' | 'hermes' =
        provider || settings.serverSideAgentProvider || 'openclaw';

    const [messages, setMessages] = useState<AgentMessage[]>([]);
    const [input, setInput] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    const [, setSessions] = useState<any[]>([]);
    const [, setSkills] = useState<any[]>([]);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        fetchAgentContext();
    }, [settings]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, isThinking]);

    const fetchAgentContext = async () => {
        try {
            const [sessResp, skillResp] = await Promise.all([
                fetch(`${settings.serverUrl}/api/agent/sessions`, { headers: { 'x-api-key': settings.apiKey } }),
                fetch(`${settings.serverUrl}/api/agent/skills`, { headers: { 'x-api-key': settings.apiKey } })
            ]);
            if (sessResp.ok) {
                const data = await sessResp.json();
                setSessions(data.sessions || []);
            }
            if (skillResp.ok) {
                const data = await skillResp.json();
                setSkills(data.skills || []);
            }
        } catch (e) {
            logger.log('error', '[ServerAgentView] Failed to fetch agent context', e);
        }
    };

    const handleSend = async () => {
        if (!input.trim() || isThinking) return;
        triggerHaptic();

        const userMsg: AgentMessage = { role: 'user', content: input };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setIsThinking(true);

        try {
            // Use the streaming endpoint so tokens arrive progressively
            const resp = await fetch(`${settings.serverUrl}/api/agent/task/stream`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': settings.apiKey
                },
                body: JSON.stringify({
                    prompt: input,
                    provider: activeProvider
                })
            });

            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

            const reader = resp.body?.getReader();
            if (!reader) throw new Error('ReadableStream not supported');

            let assistantMsg = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const text = new TextDecoder().decode(value);
                const lines = text.split('\n').filter(l => l.trim());

                for (const line of lines) {
                    if (line === 'data: [DONE]') break;
                    try {
                        const chunk = JSON.parse(line.replace(/^data: /, ''));
                        // Server streams { delta } for both openclaw and hermes providers
                        if (chunk.delta) {
                            assistantMsg += chunk.delta;
                            updateLastMessage('assistant', assistantMsg);
                        }
                        if (chunk.error) {
                            logger.log('warn', '[ServerAgentView] Stream error chunk', chunk.error);
                        }
                    } catch {
                        // Ignore partial JSON or blank lines
                    }
                }
            }

            // If no tokens arrived (e.g. empty stream), show a fallback
            if (!assistantMsg) {
                setMessages(prev => [...prev, { role: 'assistant', content: '(No response received)' }]);
            }
        } catch (e) {
            logger.log('error', '[ServerAgentView] Task execution failed', e);
            setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Error communicating with server agent.' }]);
        } finally {
            setIsThinking(false);
        }
    };

    const updateLastMessage = (role: 'assistant' | 'thought', content: string) => {
        setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last && last.role === role) {
                return [...prev.slice(0, -1), { role, content }];
            } else {
                return [...prev, { role, content }];
            }
        });
    };

    const isHermes = activeProvider === 'hermes';

    return (
        <div className="flex flex-col h-full bg-background animate-fade-in">
            {/* Header */}
            <div className="p-4 border-b border-white/10 flex justify-between items-center bg-surface/50">
                <div>
                    <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
                        <span className={isHermes ? 'text-purple-400' : 'text-blue-500'}>
                            {isHermes ? '🔮' : '🤖'}
                        </span>
                        {isHermes ? 'Hermes Server Agent' : 'OpenClaw Server Agent'}
                    </h2>
                    <p className="text-xs text-text-secondary">Distributed intelligence via {settings.serverUrl}</p>
                </div>
                <div className="flex gap-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                        isHermes
                            ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                            : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                    }`}>
                        {isHermes ? 'HERMES' : 'OPENCLAW'}
                    </span>
                </div>
            </div>

            {/* Chat Area */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center opacity-40">
                        <span className="text-6xl mb-4">{isHermes ? '🔮' : '🧠'}</span>
                        <p className="text-sm">Start a conversation with the {isHermes ? 'Hermes' : 'OpenClaw'} agent</p>
                        <div className="mt-6 flex flex-wrap gap-2 justify-center max-w-xs">
                            {['Research latest AI news', 'Analyze my documents', 'Summarize meeting logs'].map(q => (
                                <button
                                    key={q}
                                    onClick={() => setInput(q)}
                                    className="px-3 py-1 rounded-full border border-white/10 text-[10px] hover:bg-white/5"
                                >
                                    {q}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                {messages.map((m, i) => (
                    <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm shadow-lg ${
                            m.role === 'user' ? 'bg-primary text-white rounded-tr-none' :
                            m.role === 'thought' ? 'bg-blue-500/10 text-blue-300 border border-blue-500/20 italic text-xs' :
                            'bg-surface text-text-primary rounded-tl-none border border-white/5'
                        }`}>
                            {m.role === 'thought' && <div className="text-[10px] uppercase font-bold opacity-50 mb-1">Agent Thought</div>}
                            <div className="whitespace-pre-wrap">{m.content}</div>
                        </div>
                    </div>
                ))}
                {isThinking && (
                    <div className="flex justify-start">
                        <div className="bg-surface rounded-2xl rounded-tl-none px-4 py-3 border border-white/5 flex gap-1.5 items-center">
                            {[0, 1, 2].map(i => (
                                <div key={i} className={`w-1.5 h-1.5 rounded-full animate-bounce ${isHermes ? 'bg-purple-400/60' : 'bg-blue-400/60'}`}
                                    style={{ animationDelay: `${i * 0.15}s` }} />
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Input Area */}
            <div className="p-4 border-t border-white/10 bg-surface/30">
                <div className="flex items-center gap-2">
                    <input
                        type="text"
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSend()}
                        placeholder={`Ask ${isHermes ? 'Hermes' : 'OpenClaw'}...`}
                        className="flex-1 bg-input border border-surface/40 rounded-full px-4 py-2 text-sm text-text-primary outline-none focus:border-blue-500/50 transition-colors"
                    />
                    <button
                        onClick={handleSend}
                        disabled={!input.trim() || isThinking}
                        className={`w-10 h-10 rounded-full flex items-center justify-center text-white disabled:opacity-40 transition-all active:scale-90 ${
                            isHermes ? 'bg-purple-600' : 'bg-blue-600'
                        }`}
                    >
                        {isThinking ? (
                            <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                        ) : (
                            <svg className="w-5 h-5 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                            </svg>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ServerAgentView;
