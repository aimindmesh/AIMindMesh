/**
 * AIMindMesh Server LLM Provider (v4.0.0)
 * Routes inference to the configured AGServer instance.
 * Supports token-by-token streaming via WebSocket and
 * graceful fallback if the server is unreachable.
 */

import { logger } from '../../logger';
import { AIMindMeshServerSettings } from '../../../types';
import { Device } from '@capacitor/device';
export type { AIMindMeshServerSettings };

export interface ServerStreamChunk {
    token?: string;
    done?: boolean;
    usedNode?: string; // e.g. "Laptop", "Server Ollama", "Gemini"
    error?: string;
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

let activeSocket: WebSocket | null = null;

function closeSocket() {
    if (activeSocket && activeSocket.readyState !== WebSocket.CLOSED) {
        activeSocket.close();
    }
    activeSocket = null;
}

async function streamViaWebSocket(
    settings: AIMindMeshServerSettings,
    messages: ServerChatMessage[],
    onChunk: ServerStreamCallback,
    signal?: AbortSignal,
    options?: ServerProviderOptions['options']
): Promise<void> {
    closeSocket();

    const wsUrl = settings.serverUrl.replace(/^http/, 'ws') + '/ws/chat';

    return new Promise<void>((resolve, reject) => {
        let sock: WebSocket;
        let timeoutId: any;
        try {
            sock = new WebSocket(wsUrl);
            activeSocket = sock;
            
            // Timeout to abort if connection hangs
            timeoutId = setTimeout(() => {
                if (sock.readyState !== WebSocket.OPEN) {
                    sock.close();
                    reject(new Error('WebSocket connection timeout'));
                }
            }, 5000);
        } catch (e) {
            reject(e);
            return;
        }

        signal?.addEventListener('abort', () => {
            sock.close();
            resolve();
        });

        sock.onopen = () => {
            clearTimeout(timeoutId);
            sock.send(JSON.stringify({
                messages,
                apiKey: settings.apiKey,
                stream: true,
                options: {
                    ...options,
                    routing: (settings.preferredNode || 'AUTO').toUpperCase()
                }
            }));
        };

        sock.onmessage = (ev) => {
            try {
                const chunk: ServerStreamChunk = JSON.parse(ev.data);
                onChunk(chunk);
                if (chunk.usedNode) {
                    emit('server:node_info', chunk.usedNode);
                }
                if (chunk.done) {
                    emit('server:reconnected');
                    resolve();
                    sock.close();
                }
            } catch {
                logger.log('warn', '[ServerProvider] Unparseable WS chunk', ev.data);
            }
        };

        sock.onerror = (e) => {
            clearTimeout(timeoutId);
            logger.log('error', '[ServerProvider] WebSocket error', e);
            emit('server:unreachable');
            reject(new Error('WebSocket error'));
        };

        sock.onclose = (ev) => {
            clearTimeout(timeoutId);
            if (!ev.wasClean) {
                emit('server:unreachable');
                reject(new Error(`WebSocket closed unexpectedly (code=${ev.code})`));
            }
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
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout for REST

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
        return data.response ?? data.message ?? '';
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
 * Prefers WS streaming; falls back to REST if WS fails.
 * Emits 'server:unreachable' on failure so the UI can show a banner.
 */
export async function callServerProvider(opts: ServerProviderOptions): Promise<string> {
    const { settings, messages, onChunk, signal } = opts;

    if (!settings.enabled || !settings.serverUrl) {
        throw new Error('[ServerProvider] Provider not configured');
    }

    // Try WebSocket streaming first
    if (onChunk) {
        try {
            await streamViaWebSocket(settings, messages, onChunk, signal, opts.options);
            return ''; // full text assembled by caller from chunks
        } catch (e) {
            logger.log('warn', '[ServerProvider] WS failed, falling back to REST', e);
        }
    }

    // REST fallback
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

export function abortServerStream() {
    closeSocket();
}
