/**
 * FeedView.tsx (v4.0.0)
 * Main Feed screen — infinite scroll list of server insights.
 * Shows empty state when server is not configured or has no items.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { AIMindMeshServerSettings } from '../types';
import { InsightItem, fetchFeedPage, markInsightRead, deleteInsight } from '../services/feedService';
import { onFCMFeedEvent } from '../services/fcmService';
import InsightCard from '../components/InsightCard';
import ImportSheet from '../components/ImportSheet';

interface Props {
    serverSettings: AIMindMeshServerSettings | undefined;
    onOpenThread: (insight: InsightItem) => void;
    onUnreadCountChange?: (count: number) => void;
}

const FeedView: React.FC<Props> = ({ serverSettings, onOpenThread, onUnreadCountChange }) => {
    const [items, setItems] = useState<InsightItem[]>([]);
    const [page, setPage] = useState(0);
    const [hasMore, setHasMore] = useState(true);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showImport, setShowImport] = useState(false);
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const loaderRef = useRef<HTMLDivElement>(null);
    const PAGE_SIZE = 20;

    const serverConfigured = !!(serverSettings?.enabled && serverSettings?.serverUrl);
    const isServerDisabled = !!(serverSettings?.serverUrl && !serverSettings?.enabled);

    // ─── Load feed page ──────────────────────────────────────────────────────

    const loadPage = useCallback(async (pageNum: number, refresh = false) => {
        if (!serverConfigured) return;
        if (loading) return;
        setLoading(true);
        setError(null);
        try {
            const newItems = await fetchFeedPage(serverSettings!, pageNum, PAGE_SIZE);
            if (!Array.isArray(newItems)) {
                setHasMore(false);
                return;
            }
            if (refresh) {
                setItems(newItems);
                setPage(1);
            } else {
                setItems(prev => [...prev, ...newItems]);
                setPage(pageNum + 1);
            }
            setHasMore(newItems.length === PAGE_SIZE);
        } catch (e: any) {
            setError(e?.message ?? 'Failed to load feed');
        } finally {
            setLoading(false);
        }
    }, [serverConfigured, serverSettings, loading]);

    // Initial load
    useEffect(() => {
        if (serverConfigured) loadPage(0, true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [serverConfigured]);

    // Pull-to-refresh: expose on component (intersection observer for infinite scroll)
    useEffect(() => {
        if (!loaderRef.current || typeof window.IntersectionObserver === 'undefined') return;
        const observer = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && hasMore && !loading) {
                loadPage(page);
            }
        }, { threshold: 0.1 });
        observer.observe(loaderRef.current);
        return () => observer.disconnect();
    }, [loaderRef, hasMore, loading, page, loadPage]);

    // FCM new insight → prepend to list
    useEffect(() => {
        return onFCMFeedEvent(event => {
            if (event.type === 'new_insight' && serverConfigured) {
                // Refresh from top to get the full new item with metadata
                loadPage(0, true);
            } else if (event.type === 'mark_read') {
                setItems(prev => prev.map(i =>
                    i.id === event.insightId ? { ...i, read_at: Date.now() } : i
                ));
            }
        });
    }, [serverConfigured, loadPage]);

    // Update unread badge count
    useEffect(() => {
        const unread = items.filter(i => !i.read_at).length;
        onUnreadCountChange?.(unread);
    }, [items, onUnreadCountChange]);

    const groupedInsights = useMemo(() => {
        const groups: Record<string, InsightItem[]> = {};
        
        const today = new Date();
        today.setHours(23, 59, 59, 999);
        
        items.forEach(insight => {
            const d = new Date(insight.created_at);
            const diffTime = today.getTime() - d.getTime();
            const diffDays = diffTime / (1000 * 60 * 60 * 24);
            
            let label = '';
            if (diffDays <= 7) {
                label = 'This Week';
            } else if (diffDays <= 14) {
                label = 'Last Week';
            } else if (diffDays <= 30) {
                label = 'This Month';
            } else {
                label = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
            }
            
            if (!groups[label]) groups[label] = [];
            groups[label].push(insight);
        });
        
        return groups;
    }, [items]);

    useEffect(() => {
        const keys = Object.keys(groupedInsights);
        if (keys.length > 0 && (!selectedDate || !keys.includes(selectedDate))) {
            setSelectedDate(keys[0]);
        }
    }, [groupedInsights, selectedDate]);

    // ─── Actions ─────────────────────────────────────────────────────────────

    const handleMarkRead = useCallback(async (insight: InsightItem) => {
        setItems(prev => prev.map(i => i.id === insight.id ? { ...i, read_at: Date.now() } : i));
        if (serverSettings) await markInsightRead(serverSettings, insight.id).catch(() => { });
    }, [serverSettings]);

    const handleDelete = useCallback(async (insight: InsightItem) => {
        setItems(prev => prev.filter(i => i.id !== insight.id));
        if (serverSettings) await deleteInsight(serverSettings, insight.id).catch(() => { });
    }, [serverSettings]);

    const handleCopy = useCallback((text: string) => {
        navigator.clipboard.writeText(text).catch(() => { });
    }, []);

    const handleTap = useCallback((insight: InsightItem) => {
        handleMarkRead(insight);
        onOpenThread(insight);
    }, [handleMarkRead, onOpenThread]);

    // ─── Render ───────────────────────────────────────────────────────────────

    const renderEmptyState = () => {
        if (isServerDisabled) {
            return (
                <div className="flex flex-col items-center justify-center h-full px-8 text-center gap-4">
                    <div className="text-5xl">🔌</div>
                    <h2 className="text-xl font-bold text-text-primary">Integration Disabled</h2>
                    <p className="text-sm text-text-secondary leading-relaxed">
                        Flip the <b>"Enable Server Integration"</b> master switch in Settings → AIMindMesh Server to wake up the engine.
                    </p>
                </div>
            );
        }
        if (!serverConfigured) {
            return (
                <div className="flex flex-col items-center justify-center h-full px-8 text-center gap-4">
                    <div className="text-5xl">🌐</div>
                    <h2 className="text-xl font-bold text-text-primary">Connect your AIMindMesh Server</h2>
                    <p className="text-sm text-text-secondary leading-relaxed">
                        Configure your server in Settings → AIMindMesh Server to receive proactive insights.
                    </p>
                </div>
            );
        }
        return (
            <div className="flex flex-col items-center justify-center h-full px-8 text-center gap-4">
                <div className="text-5xl">✨</div>
                <h2 className="text-xl font-bold text-text-primary">No insights yet</h2>
                <p className="text-sm text-text-secondary">The engine will think for you and post insights here.</p>
            </div>
        );
    };

    return (
        <div className="flex flex-col h-full bg-background relative overflow-hidden">
            {/* Header */}
            <header className="px-5 pt-5 pb-3 flex items-center justify-between shrink-0">
                <div>
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-purple-400 bg-clip-text text-transparent">
                        Feed
                    </h1>
                    <p className="text-xs text-text-secondary mt-0.5">AI-generated insights from your knowledge graph</p>
                </div>
                {serverConfigured && (
                    <button
                        id="feed-refresh-btn"
                        onClick={() => loadPage(0, true)}
                        disabled={loading}
                        className="p-2 rounded-xl bg-surface/80 border border-white/10 hover:border-primary/30 transition-all disabled:opacity-40"
                        aria-label="Refresh feed"
                    >
                        <svg className={`w-4 h-4 text-text-secondary ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    </button>
                )}
            </header>

            {/* Error banner */}
            {error && (
                <div className="mx-5 mb-3 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
                    {error}
                </div>
            )}

            {/* Scroll list */}
            <div className="flex-1 overflow-y-auto px-5 pb-24">
                {items.length === 0 && !loading ? (
                    renderEmptyState()
                ) : (
                    <div className="flex flex-col gap-3 pt-1">
                        {Object.keys(groupedInsights).length > 0 && (
                            <div className="flex items-center gap-2 overflow-x-auto custom-scrollbar pb-3 mb-2 -mx-5 px-5">
                                {Object.keys(groupedInsights).map(dateLabel => (
                                    <button
                                        key={dateLabel}
                                        onClick={() => setSelectedDate(dateLabel)}
                                        className={`shrink-0 px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
                                            selectedDate === dateLabel 
                                                ? 'bg-primary text-primary-foreground shadow-md' 
                                                : 'bg-surface border border-white/10 text-text-secondary hover:text-text-primary'
                                        }`}
                                    >
                                        {dateLabel}
                                    </button>
                                ))}
                            </div>
                        )}
                        {(groupedInsights[selectedDate || ''] || []).map(insight => (
                            <InsightCard
                                key={insight.id}
                                insight={insight}
                                onTap={handleTap}
                                onMarkRead={handleMarkRead}
                                onCopy={handleCopy}
                                onDelete={handleDelete}
                            />
                        ))}
                        {/* Infinite scroll sentinel */}
                        <div ref={loaderRef} className="py-4 flex justify-center">
                            {loading && (
                                <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* FAB — Add to Knowledge */}
            {serverConfigured && (
                <button
                    id="feed-add-knowledge-fab"
                    onClick={() => setShowImport(true)}
                    className="absolute bottom-6 right-5 w-12 h-12 rounded-full bg-gradient-to-br from-primary to-purple-600 shadow-lg shadow-primary/30 flex items-center justify-center hover:opacity-90 active:scale-95 transition-all"
                    aria-label="Add to Knowledge"
                >
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                </button>
            )}

            {showImport && (
                <ImportSheet
                    serverSettings={serverSettings}
                    onClose={() => setShowImport(false)}
                />
            )}
        </div>
    );
};

export default FeedView;
