/**
 * feedService.ts (v4.0.0)
 * REST + WebSocket client for the AIMindMesh Feed screen.
 * Depends on AIMindMeshServerSettings being configured.
 */

import { AIMindMeshServerSettings } from '../types';
import type { FeedItem } from '@aimindmesh/api-types';
import { createLineDecoder } from './streamLines';
// logger removed if unused to fix TS6133

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InsightItem {
    id: string;
    content: string;       // Server uses 'content' instead of 'text'
    created_at: number;    // Server uses 'created_at' (timestamp) instead of 'createdAt'
    read_at: number | null; // Server uses 'read_at' instead of 'isRead'
    reply_thread_id?: string;
    source_node_ids?: string; // Comma-separated or JSON list from server
    usedNode?: string;        // Optional used inference node
    type?: FeedItem['type'];
}

export interface ThreadMessage {
    id: string;
    role: 'user' | 'assistant' | 'ADVOCATE' | 'CRITIC' | 'ORCHESTRATOR' | 'HUMAN';
    content: string;
    created_at: number;
    usedNode?: string;
}

export interface FeedThread {
    item: InsightItem;
    replies: ThreadMessage[];
    status?: 'ACTIVE' | 'CLOSED';
}

export type FeedStreamChunk = {
    token?: string;
    done?: boolean;
    usedNode?: string;
    /** Author of the message (debate agent or 'assistant') */
    role?: ThreadMessage['role'];
    error?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function headers(settings: AIMindMeshServerSettings) {
    return {
        'Content-Type': 'application/json',
        'x-api-key': settings.apiKey
    };
}

/** For body-less requests (DELETE): a JSON Content-Type with an empty body used to be rejected */
function authHeaders(settings: AIMindMeshServerSettings) {
    return { 'x-api-key': settings.apiKey };
}

function base(settings: AIMindMeshServerSettings) {
    return settings.serverUrl.replace(/\/$/, '');
}

// ─── Feed List ────────────────────────────────────────────────────────────────

export async function fetchFeedPage(
    settings: AIMindMeshServerSettings,
    page = 0,
    pageSize = 20
): Promise<InsightItem[]> {
    const limit = pageSize;
    const offset = page * pageSize;
    const url = `${base(settings)}/api/feed?limit=${limit}&offset=${offset}`;

    const resp = await fetch(url, {
        headers: headers(settings),
        signal: AbortSignal.timeout(10000)
    });
    if (!resp.ok) throw new Error(`Feed fetch failed: ${resp.status}`);
    const data = await resp.json();
    const items = data.items ?? (Array.isArray(data) ? data : []);
    return items;
}

export async function markInsightRead(
    settings: AIMindMeshServerSettings,
    insightId: string
): Promise<void> {
    await fetch(`${base(settings)}/api/feed/${insightId}/read`, {
        method: 'POST',
        headers: headers(settings),
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(5000)
    });
}

export async function deleteInsight(
    settings: AIMindMeshServerSettings,
    insightId: string
): Promise<void> {
    const resp = await fetch(`${base(settings)}/api/feed/${insightId}`, {
        method: 'DELETE',
        headers: authHeaders(settings),
        signal: AbortSignal.timeout(5000)
    });
    if (!resp.ok) throw new Error(`Delete failed: ${resp.status}`);
}

// ─── Archives (Library) ───────────────────────────────────────────────────────

export async function fetchArchives(settings: AIMindMeshServerSettings, limit: number = 100): Promise<any[]> {
    const resp = await fetch(`${base(settings)}/api/ai-tasks/archives?limit=${limit}`, {
        headers: headers(settings),
        signal: AbortSignal.timeout(10000)
    });
    if (!resp.ok) throw new Error(`Archives fetch failed: ${resp.status}`);
    return await resp.json();
}

export async function deleteArchive(settings: AIMindMeshServerSettings, execId: string): Promise<void> {
    const resp = await fetch(`${base(settings)}/api/ai-tasks/executions/${execId}`, {
        method: 'DELETE',
        headers: authHeaders(settings),
        signal: AbortSignal.timeout(5000)
    });
    // The server answers 204; anything else means the archive is still there
    if (!resp.ok) throw new Error(`Archive delete failed: ${resp.status}`);
}

export async function fetchArchiveArtifact(settings: AIMindMeshServerSettings, taskId: string, execId: string): Promise<string> {
    const resp = await fetch(`${base(settings)}/api/ai-tasks/${taskId}/executions/${execId}/artifact`, {
        headers: headers(settings),
        signal: AbortSignal.timeout(15000)
    });
    if (!resp.ok) throw new Error(`Artifact fetch failed: ${resp.status}`);
    return await resp.text();
}

// ─── Thread ───────────────────────────────────────────────────────────────────

export async function fetchThread(
    settings: AIMindMeshServerSettings,
    insightId: string
): Promise<FeedThread> {
    // Attempt debate fetch first
    try {
        const debateResp = await fetch(`${base(settings)}/api/feed/${insightId}/debate`, {
            headers: headers(settings),
            signal: AbortSignal.timeout(5000)
        });
        if (debateResp.ok) {
            const debateData = await debateResp.json();
            if (debateData.thread && debateData.messages) {
                // Map debate messages to ThreadMessage format
                return {
                    item: {} as any, // Not rigorously needed by ThreadView mostly if it already has insight
                    replies: debateData.messages.map((m: any) => ({
                        id: m.id,
                        role: m.author,
                        content: m.content,
                        created_at: new Date(m.created_at).getTime(),
                        usedNode: 'debate-engine'
                    })),
                    status: debateData.thread?.status
                };
            }
        }
    } catch(e) {
        // Fallback to standard
    }

    const resp = await fetch(`${base(settings)}/api/feed/${insightId}/thread`, {
        headers: headers(settings),
        signal: AbortSignal.timeout(10000)
    });
    if (!resp.ok) throw new Error(`Thread fetch failed: ${resp.status}`);
    const data = await resp.json();
    return {
        item: data.item,
        replies: Array.isArray(data.replies) ? data.replies : []
    };
}

/**
 * Applies one reply payload: an NDJSON line of a debate stream, or the single JSON answer
 * the server gives to insights without a debate. Throws on a server error line.
 */
export function handleReplyPayload(payload: any, onChunk: (chunk: FeedStreamChunk) => void): void {
    if (payload?.type === 'agent_reply' && payload.message) {
        onChunk({
            token: payload.message.content,
            done: false, // We don't know if it's the last one yet
            usedNode: payload.message.author,
            role: payload.message.author
        });
    } else if (payload?.type === 'error') {
        throw new Error(payload.message || 'Reply failed');
    } else if (payload?.assistantReply?.content) {
        onChunk({ token: payload.assistantReply.content, done: false, role: 'assistant' });
    }
}

export async function sendReply(
    settings: AIMindMeshServerSettings,
    insightId: string,
    userMessage: string,
    onChunk: (chunk: FeedStreamChunk) => void,
    signal?: AbortSignal
): Promise<void> {
    const resp = await fetch(`${base(settings)}/api/feed/${insightId}/reply`, {
        method: 'POST',
        headers: headers(settings),
        body: JSON.stringify({ content: userMessage }),
        signal
    });
    if (!resp.ok) throw new Error(`Reply failed: ${resp.status}`);

    // Insights without a debate get one JSON answer ({ reply, assistantReply }), not a stream
    // (checked before getReader(), which locks the body)
    const isJson = (resp.headers.get('content-type') || '').includes('application/json');
    const reader = isJson ? undefined : resp.body?.getReader();
    if (!reader) {
        handleReplyPayload(await resp.json(), onChunk);
        onChunk({ done: true });
        return;
    }

    // Debate replies stream as NDJSON, one agent message per line
    const lines = createLineDecoder();
    const handleLine = (line: string) => {
        if (!line.trim()) return;
        let payload: any;
        try {
            payload = JSON.parse(line);
        } catch {
            return; // not a JSON line
        }
        handleReplyPayload(payload, onChunk);
    };

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        lines.push(value).forEach(handleLine);
    }
    lines.end().forEach(handleLine);

    // Final signal
    onChunk({ done: true });
}

export async function updateThreadStatus(
    settings: AIMindMeshServerSettings,
    insightId: string,
    status: 'ACTIVE' | 'CLOSED'
): Promise<void> {
    const resp = await fetch(`${base(settings)}/api/feed/${insightId}/debate/status`, {
        method: 'POST',
        headers: headers(settings),
        body: JSON.stringify({ status })
    });
    if (!resp.ok) throw new Error(`Status update failed: ${resp.status}`);
}
