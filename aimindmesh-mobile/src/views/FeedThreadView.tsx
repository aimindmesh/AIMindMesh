/**
 * FeedThreadView.tsx (v4.0.0)
 * Thread/reply view for a specific Feed insight.
 * Shows the insight card (read-only) and a chat-like reply thread.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AIMindMeshServerSettings } from '../types';
import { InsightItem, ThreadMessage, fetchThread, sendReply, updateThreadStatus } from '../services/feedService';
import InsightCard from '../components/InsightCard';
import { Clipboard } from '@capacitor/clipboard';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { formatThreadAsMarkdown } from '../utils/debateExport';

interface Props {
    insight: InsightItem;
    serverSettings: AIMindMeshServerSettings;
    onClose: () => void;
}

const FeedThreadView: React.FC<Props> = ({ insight, serverSettings, onClose }) => {
    const [messages, setMessages] = useState<ThreadMessage[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [streaming, setStreaming] = useState(false);
    const [streamingText, setStreamingText] = useState('');
    const [usedNode, setUsedNode] = useState<string | undefined>();
    const [status, setStatus] = useState<'ACTIVE' | 'CLOSED'>('ACTIVE');
    const abortRef = useRef<AbortController | null>(null);
    const bottomRef = useRef<HTMLDivElement>(null);

    // ─── Load thread ─────────────────────────────────────────────────────────

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const thread = await fetchThread(serverSettings, insight.id);
                if (!cancelled) {
                    setMessages(Array.isArray(thread.replies) ? thread.replies : []);
                    if (thread.status) setStatus(thread.status);
                }
            } catch {
                // Empty thread is fine on first open
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [insight.id, serverSettings]);

    // Auto scroll to bottom
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, streamingText]);

    // ─── Send reply ───────────────────────────────────────────────────────────

    const handleSend = useCallback(async () => {
        const text = input.trim();
        if (!text || streaming) return;

        setInput('');
        setMessages(prev => [...prev, {
            id: `local_${Date.now()}`,
            role: 'user',
            content: text,
            created_at: Date.now()
        }]);
        setStreaming(true);
        setStreamingText('');
        setUsedNode(undefined);

        abortRef.current = new AbortController();

        try {
            await sendReply(
                serverSettings,
                insight.id,
                text,
                chunk => {
                    const now = Date.now();
                    if (chunk.token && !chunk.done) {
                        // Append this agent's message immediately
                        setMessages(prev => [...prev, {
                            id: `reply_${now}_${chunk.usedNode || 'agent'}`,
                            role: (chunk.usedNode || 'assistant') as any,
                            content: chunk.token || '', // Fix TS2345: ensures string
                            created_at: now,
                            usedNode: chunk.usedNode
                        }]);
                    }
                    if (chunk.done) {
                        setStreaming(false);
                        setStreamingText('');
                    }
                },
                abortRef.current.signal
            );
        } catch (e: any) {
            setStreaming(false);
            setStreamingText('');
            console.error('Debate streaming error:', e);
        }
    }, [input, streaming, serverSettings, insight.id]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    };

    const handleStop = () => {
        abortRef.current?.abort();
        setStreaming(false);
        setStreamingText('');
    };

    const handleExportClipboard = async () => {
        const markdown = formatThreadAsMarkdown(insight.content, messages);
        await Clipboard.write({ string: markdown });
        alert('Copied to clipboard!');
    };

    const handleExportFile = async () => {
        try {
            const markdown = formatThreadAsMarkdown(insight.content, messages);
            const fileName = `debate_${insight.id.substring(0, 8)}_${Date.now()}.md`;
            
            await Filesystem.writeFile({
                path: fileName,
                data: markdown,
                directory: Directory.Documents,
                encoding: Encoding.UTF8
            });
            
            alert(`Thread saved to Documents as ${fileName}`);
        } catch (e: any) {
            console.error('File export failed', e);
            alert(`Export failed: ${e.message}`);
        }
    };

    const handleToggleStatus = async () => {
        const newStatus = status === 'ACTIVE' ? 'CLOSED' : 'ACTIVE';
        try {
            await updateThreadStatus(serverSettings, insight.id, newStatus);
            setStatus(newStatus);
        } catch (e: any) {
            alert('Failed to update status: ' + e.message);
        }
    };

    // ─── Render ───────────────────────────────────────────────────────────────

    return (
        <div className="flex flex-col h-full bg-background">
            {/* Header */}
            <header className="px-4 py-3 border-b border-surface flex items-center gap-3 shrink-0">
                <button
                    onClick={onClose}
                    className="p-2 rounded-xl hover:bg-surface/80 transition-colors text-text-secondary hover:text-text-primary"
                    aria-label="Back"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                </button>
                <h2 className="text-base font-semibold text-text-primary">Thread</h2>
                <div className="ml-auto flex items-center gap-1">
                    <button
                        onClick={handleToggleStatus}
                        className={`p-2 rounded-xl transition-colors ${status === 'CLOSED' ? 'text-red-400 bg-red-400/10' : 'text-green-400 hover:bg-surface/80'}`}
                        title={status === 'ACTIVE' ? 'Lock Discussion' : 'Unlock Discussion'}
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            {status === 'ACTIVE' ? (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                            ) : (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            )}
                        </svg>
                    </button>
                    <button
                        onClick={handleExportClipboard}
                        className="p-2 rounded-xl hover:bg-surface/80 transition-colors text-text-secondary hover:text-text-primary"
                        title="Copy to Clipboard"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                        </svg>
                    </button>
                    <button
                        onClick={handleExportFile}
                        className="p-2 rounded-xl hover:bg-surface/80 transition-colors text-text-secondary hover:text-text-primary"
                        title="Save as .md"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                    </button>
                </div>
            </header>

            {/* Scrollable area */}
            <div className="flex-1 overflow-y-auto px-4 pb-4">
                {/* Insight card (read-only) */}
                <div className="mt-4 mb-5">
                    <InsightCard
                        insight={insight}
                        onTap={() => { }}
                        onMarkRead={() => { }}
                        onCopy={() => { }}
                        onDelete={() => { }}
                        readOnly
                    />
                </div>

                {/* Thread messages */}
                {loading ? (
                    <div className="flex justify-center py-4">
                        <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        {Array.isArray(messages) && messages.map(msg => (
                            <div
                                key={msg.id}
                                className={`flex ${(msg.role === 'user' || msg.role === 'HUMAN') ? 'justify-end' : 'justify-start'}`}
                            >
                                <div className={`max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
                                    (msg.role === 'user' || msg.role === 'HUMAN')
                                        ? 'bg-primary text-white'
                                        : msg.role === 'ORCHESTRATOR'
                                        ? 'bg-[#6366f1]/20 text-[#a5b4fc] border border-[#6366f1]/50 font-mono'
                                        : msg.role === 'ADVOCATE'
                                        ? 'bg-[#10b981]/20 text-[#6ee7b7] border border-[#10b981]/30'
                                        : msg.role === 'CRITIC'
                                        ? 'bg-[#f43f5e]/20 text-[#fda4af] border border-[#f43f5e]/30'
                                        : 'bg-surface/80 text-text-primary border border-white/5'
                                }`}>
                                    {msg.role !== 'user' && msg.role !== 'assistant' && msg.role !== 'HUMAN' && (
                                        <div className="text-[10px] uppercase font-bold tracking-wider opacity-70 mb-1.5 flex items-center gap-1.5">
                                            {msg.role === 'ORCHESTRATOR' ? '🎯' : msg.role === 'ADVOCATE' ? '🛡️' : msg.role === 'CRITIC' ? '⚖️' : ''} {msg.role}
                                        </div>
                                    )}
                                    <div className="break-words">{msg.content}</div>
                                    {msg.usedNode && msg.usedNode !== 'debate-engine' && (
                                        <div className="text-xs opacity-60 mt-1.5">via {msg.usedNode}</div>
                                    )}
                                </div>
                            </div>
                        ))}

                        {/* Streaming bubble */}
                        {streaming && streamingText && (
                            <div className="flex justify-start">
                                <div className="max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed bg-surface/80 text-text-primary border border-white/5">
                                    {streamingText}
                                    {usedNode && (
                                        <div className="text-xs opacity-60 mt-1.5">via {usedNode}</div>
                                    )}
                                </div>
                            </div>
                        )}

                        {streaming && !streamingText && (
                            <div className="flex justify-start">
                                <div className="px-4 py-3 bg-surface/80 rounded-xl border border-white/5 flex gap-1.5 items-center">
                                    {[0, 1, 2].map(i => (
                                        <div key={i} className="w-1.5 h-1.5 bg-primary/60 rounded-full animate-bounce"
                                            style={{ animationDelay: `${i * 0.15}s` }} />
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
                <div ref={bottomRef} />
            </div>

            {/* Input bar */}
            <div className="px-4 pb-6 pt-3 border-t border-surface/50 shrink-0">
                <div className="flex items-end gap-2 bg-surface/80 rounded-2xl border border-white/10 px-4 py-2">
                    <textarea
                        id="thread-reply-input"
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        rows={1}
                        placeholder={status === 'CLOSED' ? "Discussion locked" : "Reply…"}
                        disabled={streaming || status === 'CLOSED'}
                        className="flex-1 bg-transparent text-sm text-text-primary resize-none outline-none placeholder:text-text-secondary/40 py-1 min-h-[24px] max-h-[120px] disabled:opacity-50"
                        style={{ height: 'auto' }}
                        onInput={e => {
                            const el = e.currentTarget;
                            el.style.height = 'auto';
                            el.style.height = el.scrollHeight + 'px';
                        }}
                    />
                    {streaming ? (
                        <button onClick={handleStop}
                            className="p-2 rounded-xl bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors shrink-0"
                            aria-label="Stop">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                <rect x="6" y="6" width="12" height="12" rx="2" />
                            </svg>
                        </button>
                    ) : (
                        <button onClick={handleSend} disabled={!input.trim()}
                            className="p-2 rounded-xl bg-primary text-white disabled:opacity-30 hover:opacity-90 transition-all shrink-0"
                            aria-label="Send">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m-7 7l7-7 7 7" />
                            </svg>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FeedThreadView;
