/**
 * AIMindMesh Server LLM Provider (v4.0.0)
 * Routes inference to the configured AGServer instance.
 * Supports token-by-token streaming via WebSocket and
 * graceful fallback if the server is unreachable.
 */

import { logger } from '../../logger';
import { AIMindMeshServerSettings } from '../../../types';
import { Device } from '@capacitor/device';
import type { ChatCompletionEvent, ChatCompletionRequest } from '@aimindmesh/api-types';
export type { AIMindMeshServerSettings };

export interface ServerStreamChunk {
    token?: string;
    thought?: string;
    done?: boolean;
    usedNode?: string; // e.g. "Laptop", "Server Ollama", "Gemini"
}

export interface ServerStats {
    cpu?: number;
    ram?: { total: string; used: string; percent: number };
    gpu?: { id: string; memTotal: string; memUsed: string }[];
    uptime?: string;
    nodeCount?: number;
}

export interface FcmLog {
    id: string;
    status: 'SUCCESS' | 'FAILED';
    recipient: string;
    message: string;
    timestamp: number;
}

export interface ServerNode {
    id: string;
    type: 'mobile' | 'pc' | 'local';
    status: 'ONLINE' | 'OFFLINE';
    last_heartbeat: number;
    capabilities: string[];
    fcm_token?: string;
}

export interface AgentStatus {
    available: boolean;
    sessionCount?: number;
    uptime?: string;
}

export type ServerStreamCallback = (chunk: ServerStreamChunk) => void;

export interface ServerChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

/** Events emitted by the server provider (listened by UI for banners/chips) */
type ProviderEvent = 'server:unreachable' | 'server:reconnected' | 'server:node_info';

const providerListeners = new Map<ProviderEvent, Set<(data: any) => void>>();

export function onServerProviderEvent(event: ProviderEvent, cb: (data: any) => void): () => void {
    if (!providerListeners.has(event)) providerListeners.set(event, new Set());
    providerListeners.get(event)!.add(cb);
    return () => providerListeners.get(event)?.delete(cb);
}

function emit(event: ProviderEvent, data?: any) {
    providerListeners.get(event)?.forEach(cb => cb(data));
}

// ─── WebSocket Streaming ──────────────────────────────────────────────────────

/** Timeouts of a streamed completion (ms) */
const WS_CONNECT_TIMEOUT = 5000;
/** The server acknowledges a request at once: silence means an old server or a broken link */
const WS_ACK_TIMEOUT = 10000;
/** After the ack the request may wait in the server queue (e.g. a model loading) */
const WS_FIRST_EVENT_TIMEOUT = 90000;
const WS_IDLE_TIMEOUT = 60000;
const REST_TIMEOUT = 120000;

/** The WebSocket path cannot be used at all (nothing was generated): REST may be tried */
class WsUnavailableError extends Error {}

// One socket per request (a new chat never kills another one still streaming), with its abort
const activeSockets = new Map<WebSocket, () => void>();

const newRequestId = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function streamViaWebSocket(
    settings: AIMindMeshServerSettings,
    messages: ServerChatMessage[],
    onChunk: ServerStreamCallback,
    signal?: AbortSignal,
    options?: ServerProviderOptions['options']
): Promise<void> {
    if (signal?.aborted) return;
    // Browser WebSockets cannot set headers: the server accepts the API key as the `token` query param
    const wsUrl = settings.serverUrl.replace(/\/$/, '').replace(/^http/, 'ws') +
        '/ws/chat?mode=completion&token=' + encodeURIComponent(settings.apiKey || '');
    const requestId = newRequestId();

    return new Promise<void>((resolve, reject) => {
        let sock: WebSocket;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let acked = false;
        let settled = false;

        const finish = (error?: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            activeSockets.delete(sock);
            signal?.removeEventListener('abort', onAbort);
            if (sock.readyState === WebSocket.OPEN || sock.readyState === WebSocket.CONNECTING) sock.close();
            if (error) reject(error); else resolve();
        };
        const arm = (ms: number, error: () => Error) => {
            clearTimeout(timer);
            timer = setTimeout(() => finish(error()), ms);
        };
        const onAbort = () => finish();

        try {
            sock = new WebSocket(wsUrl);
        } catch (e: any) {
            reject(new WsUnavailableError(e?.message || 'WebSocket unavailable'));
            return;
        }
        activeSockets.set(sock, onAbort);
        signal?.addEventListener('abort', onAbort);
        arm(WS_CONNECT_TIMEOUT, () => new WsUnavailableError('WebSocket connection timeout'));

        sock.onopen = () => {
            const request: ChatCompletionRequest = {
                type: 'completion',
                requestId,
                messages,
                options: { ...options, routing: (settings.preferredNode || 'AUTO').toUpperCase() },
            };
            sock.send(JSON.stringify(request));
            arm(WS_ACK_TIMEOUT, () => new WsUnavailableError('Server did not acknowledge the request'));
        };

        sock.onmessage = (ev) => {
            let event: ChatCompletionEvent;
            try {
                event = JSON.parse(ev.data);
            } catch {
                logger.log('warn', '[ServerProvider] Unparseable WS event', ev.data);
                return;
            }
            if (event.requestId !== undefined && event.requestId !== requestId) return;

            switch (event.type) {
                case 'ack':
                    acked = true;
                    arm(WS_FIRST_EVENT_TIMEOUT, () => new Error('The server did not start answering in time'));
                    return;
                case 'delta':
                    arm(WS_IDLE_TIMEOUT, () => new Error('The server stopped answering'));
                    onChunk({ token: event.content });
                    return;
                case 'thought':
                    arm(WS_IDLE_TIMEOUT, () => new Error('The server stopped answering'));
                    onChunk({ thought: event.content });
                    return;
                case 'done':
                    onChunk({ done: true, usedNode: event.usedNode });
                    if (event.usedNode) emit('server:node_info', event.usedNode);
                    finish();
                    return;
                case 'error':
                    finish(new Error(event.message || 'Server error'));
                    return;
            }
        };

        sock.onerror = (e) => {
            logger.log('error', '[ServerProvider] WebSocket error', e);
            finish(acked ? new Error('WebSocket error') : new WsUnavailableError('WebSocket error'));
        };

        sock.onclose = (ev) => {
            const message = `WebSocket closed before the answer was complete (code=${ev.code})`;
            finish(acked ? new Error(message) : new WsUnavailableError(message));
        };
    });
}

// ─── REST Fallback ────────────────────────────────────────────────────────────

async function sendViaREST(
    settings: AIMindMeshServerSettings,
    messages: ServerChatMessage[],
    signal?: AbortSignal,
    options?: ServerProviderOptions['options']
): Promise<string> {
    const controller = new AbortController();
    // Real inference: the old 8s limit made the fallback fail almost always
    const timeoutId = setTimeout(() => controller.abort(), REST_TIMEOUT);

    // If caller provided a signal, link it
    if (signal) {
        signal.addEventListener('abort', () => controller.abort());
        if (signal.aborted) controller.abort();
    }

    try {
        const resp = await fetch(`${settings.serverUrl}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': settings.apiKey,
                'x-routing': (settings.preferredNode || 'AUTO').toUpperCase()
            },
            body: JSON.stringify({ 
                messages, 
                stream: false, 
                options: {
                    ...options,
                    routing: (settings.preferredNode || 'AUTO').toUpperCase()
                } 
            }),
            signal: controller.signal
        });

        if (!resp.ok) throw new Error(`Server returned ${resp.status}`);
        const data = await resp.json();
        // POST /api/chat answers { role, content, usedNode } (newer servers also mirror it in `response`)
        return data.content ?? data.response ?? data.message ?? '';
    } finally {
        clearTimeout(timeoutId);
    }
}

// ─── Connection Test ──────────────────────────────────────────────────────────

/** Returns active node description or throws if unreachable */
export async function testServerConnection(settings: AIMindMeshServerSettings): Promise<string> {
    const resp = await fetch(`${settings.serverUrl}/api/chat/provider`, {
        headers: { 'x-api-key': settings.apiKey },
        signal: AbortSignal.timeout(8000)
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    return data.activeNode ?? data.provider ?? 'Connected';
}

/** Fetch server version string */
export async function fetchServerVersion(settings: AIMindMeshServerSettings): Promise<string> {
    try {
        const resp = await fetch(`${settings.serverUrl}/api/health`, {
            headers: { 'x-api-key': settings.apiKey },
            signal: AbortSignal.timeout(5000)
        });
        if (!resp.ok) return '';
        const data = await resp.json();
        return data.version ?? '';
    } catch {
        return '';
    }
}

/** Fetch server statistics */
export async function fetchServerStats(settings: AIMindMeshServerSettings): Promise<ServerStats | null> {
    try {
        const resp = await fetch(`${settings.serverUrl}/api/admin/status`, {
            headers: { 'x-api-key': settings.apiKey },
            signal: AbortSignal.timeout(5000)
        });
        if (!resp.ok) return null;
        return await resp.json();
    } catch (e) {
        logger.log('error', '[ServerProvider] Failed to fetch stats', e);
        return null;
    }
}

/** Fetch FCM logs from server */
export async function fetchServerFcmLogs(settings: AIMindMeshServerSettings, limit = 50): Promise<FcmLog[]> {
    try {
        const resp = await fetch(`${settings.serverUrl}/api/admin/fcm/logs?limit=${limit}`, {
            headers: { 'x-api-key': settings.apiKey },
            signal: AbortSignal.timeout(5000)
        });
        if (!resp.ok) return [];
        const data = await resp.json();
        return data.logs ?? [];
    } catch (e) {
        logger.log('error', '[ServerProvider] Failed to fetch FCM logs', e);
        return [];
    }
}

/** Fetch registered nodes */
export async function fetchServerNodes(settings: AIMindMeshServerSettings): Promise<ServerNode[]> {
    try {
        const resp = await fetch(`${settings.serverUrl}/api/nodes`, {
            headers: { 'x-api-key': settings.apiKey },
            signal: AbortSignal.timeout(5000)
        });
        if (!resp.ok) return [];
        const data = await resp.json();
        return data.nodes ?? [];
    } catch (e) {
        logger.log('error', '[ServerProvider] Failed to fetch nodes', e);
        return [];
    }
}

/** Fetch server agent status */
export async function fetchServerAgentStatus(settings: AIMindMeshServerSettings): Promise<AgentStatus> {
    try {
        const resp = await fetch(`${settings.serverUrl}/api/agent/status`, {
            headers: { 'x-api-key': settings.apiKey },
            signal: AbortSignal.timeout(5000)
        });
        if (!resp.ok) return { available: false };
        return await resp.json();
    } catch {
        return { available: false };
    }
}

/** Update node settings (e.g. delivery mode) */
export async function updateDeviceSettings(settings: AIMindMeshServerSettings, deviceSettings: { deliveryMode: 'PUSH' | 'CONTEXTUAL' }): Promise<void> {
    const resp = await fetch(`${settings.serverUrl}/api/delivery/settings`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': settings.apiKey,
            'x-device-id': (await Device.getId()).identifier
        },
        body: JSON.stringify(deviceSettings)
    });
    if (!resp.ok) throw new Error(`Failed to update delivery settings: ${resp.status}`);
}

// ─── Main Provider Entry Point ────────────────────────────────────────────────

export interface ServerProviderOptions {
    settings: AIMindMeshServerSettings;
    messages: ServerChatMessage[];
    /** Called for each streamed token */
    onChunk?: ServerStreamCallback;
    /** AbortSignal for cancellation */
    signal?: AbortSignal;
    /** Extra options like thinking or searchEnabled */
    options?: {
        thinking?: boolean;
        searchEnabled?: boolean;
        routing?: string;
    };
}

/**
 * Primary entry-point used by the LLM orchestration layer.
 * Streams over WebSocket; REST is used only when the WebSocket path is unusable
 * (no connection, or a server that does not acknowledge `completion`), so nothing has
 * been generated yet. Emits 'server:unreachable' only for connection problems.
 */
export async function callServerProvider(opts: ServerProviderOptions): Promise<string> {
    const { settings, messages, onChunk, signal } = opts;

    if (!settings.enabled || !settings.serverUrl) {
        throw new Error('[ServerProvider] Provider not configured');
    }

    if (onChunk) {
        try {
            await streamViaWebSocket(settings, messages, onChunk, signal, opts.options);
            emit('server:reconnected');
            return ''; // full text assembled by caller from chunks
        } catch (e) {
            if (!(e instanceof WsUnavailableError)) throw e; // a server-side failure: REST would just repeat it
            logger.log('warn', '[ServerProvider] WebSocket unavailable, falling back to REST', e);
        }
    }

    try {
        const text = await sendViaREST(settings, messages, signal, opts.options);
        emit('server:reconnected');
        return text;
    } catch (e) {
        logger.log('error', '[ServerProvider] REST also failed', e);
        emit('server:unreachable');
        throw e;
    }
}

/** Stops every streaming request in flight (their promises resolve with what was received). */
export function abortServerStream() {
    [...activeSockets.values()].forEach(abort => abort());
}
