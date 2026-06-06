/**
 * InsightCard.tsx (v4.0.0)
 * Premium card component for Feed screen insight items.
 */

import React, { useState, useCallback } from 'react';
import { InsightItem } from '../services/feedService';

interface Props {
    insight: InsightItem;
    onTap: (insight: InsightItem) => void;
    onMarkRead: (insight: InsightItem) => void;
    onCopy: (text: string) => void;
    onDelete: (insight: InsightItem) => void;
    /** If true, renders in read-only mode (Thread View header) */
    readOnly?: boolean;
}

function timeAgo(timestamp: number): string {
    const diff = Date.now() - (timestamp > 1e12 ? timestamp : timestamp * 1000); // Handle seconds vs ms
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

const InsightCard: React.FC<Props> = ({
    insight, onTap, onMarkRead, onCopy, onDelete, readOnly = false
}) => {
    const [expanded, setExpanded] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [longPressTimer, setLongPressTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

    const LONG_PRESS_MS = 500;
    const TEXT_TRUNCATE = 800;
    const text = insight.content || '';
    const isRead = !!insight.read_at;
    const isLong = text.length > TEXT_TRUNCATE;
    const displayText = isLong && !expanded
        ? text.substring(0, TEXT_TRUNCATE) + '…'
        : text;

    const handlePressStart = useCallback(() => {
        if (readOnly) return;
        const t = setTimeout(() => setMenuOpen(true), LONG_PRESS_MS);
        setLongPressTimer(t);
    }, [readOnly]);

    const handlePressEnd = useCallback(() => {
        if (longPressTimer) clearTimeout(longPressTimer);
    }, [longPressTimer]);

    const handleTap = useCallback(() => {
        if (menuOpen) { setMenuOpen(false); return; }
        if (!readOnly) onTap(insight);
    }, [menuOpen, readOnly, onTap, insight]);

    return (
        <div
            className={`
                relative rounded-2xl overflow-hidden border transition-all duration-200 select-none
                ${isRead ? 'border-white/5 bg-surface/60' : 'border-primary/20 bg-surface/90'}
                ${!readOnly ? 'hover:border-primary/30 cursor-pointer active:scale-[0.99]' : ''}
            `}
            onPointerDown={handlePressStart}
            onPointerUp={handlePressEnd}
            onPointerLeave={handlePressEnd}
            onClick={handleTap}
        >
            {/* Unread indicator */}
            {!isRead && (
                <div
                    className="absolute left-0 top-0 bottom-0 w-0.5 bg-gradient-to-b from-primary to-purple-600"
                    aria-label="Unread"
                />
            )}

            <div className="p-4 pl-5">
                {/* Header row */}
                <div className="flex items-start justify-between gap-3 mb-2">
                    <span className="text-xs text-text-secondary/70 tabular-nums shrink-0">
                        {timeAgo(insight.created_at)}
                    </span>
                    {/* replyCount removed - not present on server FeedItem */}
                </div>

                {/* Insight text */}
                <p className="text-sm text-text-primary leading-relaxed">
                    {displayText}
                </p>
                {isLong && (
                    <button
                        onClick={e => { e.stopPropagation(); setExpanded(v => !v); }}
                        className="text-xs text-primary mt-1 hover:underline"
                    >
                        {expanded ? 'Show less' : 'Show more'}
                    </button>
                )}

                {/* Source concept chips */}
                {insight.source_node_ids && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                        {insight.source_node_ids.split(',').slice(0, 4).map((concept: string) => (
                            <span
                                key={concept}
                                className="text-xs bg-white/5 text-text-secondary px-2 py-0.5 rounded-full border border-white/5"
                            >
                                {concept.trim()}
                            </span>
                        ))}
                        {insight.source_node_ids.split(',').length > 4 && (
                            <span className="text-xs text-text-secondary/50">+{insight.source_node_ids.split(',').length - 4}</span>
                        )}
                    </div>
                )}

                {/* Used node chip */}
                {insight.usedNode && (
                    <span className="inline-block mt-2 text-xs bg-green-500/10 text-green-400 px-2 py-0.5 rounded-full border border-green-500/10">
                        via {insight.usedNode}
                    </span>
                )}
            </div>

            {/* Long-press context menu */}
            {menuOpen && (
                <div
                    className="absolute inset-0 bg-black/80 flex items-center justify-center gap-3 z-10 animate-fade-in"
                    onClick={e => { e.stopPropagation(); setMenuOpen(false); }}
                >
                    {!isRead && (
                        <button
                            onClick={e => { e.stopPropagation(); setMenuOpen(false); onMarkRead(insight); }}
                            className="px-3 py-2 bg-primary/20 text-primary rounded-xl text-sm font-medium hover:bg-primary/30"
                        >
                            Mark Read
                        </button>
                    )}
                    <button
                        onClick={e => { e.stopPropagation(); setMenuOpen(false); onCopy(text); }}
                        className="px-3 py-2 bg-white/10 text-text-primary rounded-xl text-sm font-medium hover:bg-white/15"
                    >
                        Copy
                    </button>
                    <button
                        onClick={e => { e.stopPropagation(); setMenuOpen(false); onDelete(insight); }}
                        className="px-3 py-2 bg-red-500/20 text-red-400 rounded-xl text-sm font-medium hover:bg-red-500/30"
                    >
                        Delete
                    </button>
                </div>
            )}
        </div>
    );
};

export default InsightCard;
