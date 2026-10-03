import { logger } from '../logger';
import { Device } from '@capacitor/device';
import { PluginListenerHandle } from '@capacitor/core';
import { AIMindMeshServerSettings, LLMConfig, Personality } from '../../types';
import { generateTextResponseStream } from '../llm/llmService';
import { App } from '@capacitor/app';
import { saveNativeKvCache } from '../llm/nativeLLM';
import { saveLiteRTKvCache } from '../llm/providers/liteRT/plugin';

/** Reconnect delay after a closed link: doubles up to the maximum, reset once connected */
export const RECONNECT_MIN_MS = 2_000;
export const RECONNECT_MAX_MS = 60_000;

/** What identifies the server link: a change means reconnecting */
const connectionKey = (s: AIMindMeshServerSettings) => `${s.serverUrl}|${s.apiKey}|${s.deviceName ?? ''}`;

class MobileNodeWorker {
    private ws: WebSocket | null = null;
    private serverSettings: AIMindMeshServerSettings | null = null;
    private connectedKey = '';
    private llmConfig: LLMConfig | null = null;
    private personality: Personality | null = null;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectDelayMs = RECONNECT_MIN_MS;
    private connecting = false;
    private survivalTimer: ReturnType<typeof setInterval> | null = null;
    private appStateListener: Promise<PluginListenerHandle> | null = null;
    private statusListeners: ((isWorking: boolean) => void)[] = [];
    private activeTaskAbort: AbortController | null = null;
    public isWorking: boolean = false;

    public onStatusChange(callback: (isWorking: boolean) => void) {
        this.statusListeners.push(callback);
    }

    public removeStatusListener(callback: (isWorking: boolean) => void) {
        this.statusListeners = this.statusListeners.filter(cb => cb !== callback);
    }

    private updateStatus(isWorking: boolean) {
        this.isWorking = isWorking;
        this.statusListeners.forEach(cb => cb(isWorking));
    }

    /**
     * Starts (or keeps) the worker link. Safe to call repeatedly: timers and listeners are
     * created once, and the socket is reopened only when the server address or key changed.
     */
    public init(settings: AIMindMeshServerSettings, llmConfig?: LLMConfig, personality?: Personality) {
        this.updateConfig(llmConfig, personality);

        const key = connectionKey(settings);
        if (this.connectedKey && key !== this.connectedKey) {
            logger.log('info', '[NodeWorker] Server settings changed: reconnecting');
            this.closeSocket();
            this.reconnectDelayMs = RECONNECT_MIN_MS;
        }
        this.serverSettings = settings;
        this.connectedKey = key;

        // Survival logging: verify if worker is alive and logging is working
        if (!this.survivalTimer) {
            this.survivalTimer = setInterval(() => {
                logger.log('debug', `[NodeWorker] SURVIVAL CHECK - Status: ${this.isWorking ? 'BUSY' : 'IDLE'}, WS: ${this.ws?.readyState}`);
            }, 5000);
        }

        // [KV CACHE] Persistence trigger: flush to disk when app goes to background
        if (!this.appStateListener) {
            this.appStateListener = App.addListener('appStateChange', async ({ isActive }) => {
                if (!isActive) {
                    logger.log('info', '[NodeWorker] App backgrounding. Flushing KV cache to disk...');
                    await this.flushCache();
                }
            });
        }

        void this.connect();
    }

    /** The model and personality remote tasks run with; no reconnect needed */
    public updateConfig(llmConfig?: LLMConfig | null, personality?: Personality | null) {
        if (llmConfig) this.llmConfig = llmConfig;
        if (personality) this.personality = personality;
    }

    private async flushCache() {
        if (!this.llmConfig) return;
        
        try {
            if (this.llmConfig.provider === 'native-gguf' || this.llmConfig.engine === 'gguf') {
                await saveNativeKvCache('chat');
                await saveNativeKvCache('tool');
            } else if (this.llmConfig.provider === 'litert' || this.llmConfig.engine === 'litert') {
                await saveLiteRTKvCache('chat');
            }
        } catch (e) {
            logger.log('warn', '[NodeWorker] Failed to flush cache:', e);
        }
    }

    public stop() {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        this.reconnectDelayMs = RECONNECT_MIN_MS;
        this.serverSettings = null;
        this.connectedKey = '';
        if (this.survivalTimer) clearInterval(this.survivalTimer);
        this.survivalTimer = null;
        this.appStateListener?.then(handle => handle.remove()).catch(() => { });
        this.appStateListener = null;
        this.closeSocket();
    }

    /** Closes the current socket without triggering its reconnect */
    private closeSocket() {
        const socket = this.ws;
        this.ws = null;
        if (socket) {
            socket.onclose = null;
            socket.close();
        }
    }

    private scheduleReconnect() {
        if (!this.serverSettings || this.reconnectTimer) return;
        const delay = this.reconnectDelayMs;
        this.reconnectDelayMs = Math.min(delay * 2, RECONNECT_MAX_MS);
        logger.log('warn', `[NodeWorker] Neural link closed, reconnecting in ${Math.round(delay / 1000)}s...`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void this.connect();
        }, delay);
    }

    /** Opens the link now (also used when a push wakes the app); no-op if already open */
    public async connect() {
        if (!this.serverSettings || !this.serverSettings.enabled || !this.serverSettings.serverUrl) return;
        if (this.connecting) return; // a second socket would be opened while awaiting the device id
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        this.connecting = true;
        try {
            const deviceId = await Device.getId();
            const settings = this.serverSettings;
            if (!settings) return; // stopped meanwhile
            // Browser WebSockets cannot set headers: the server accepts the API key as the `token` query param
            const wsUrl = settings.serverUrl.replace(/^http/, 'ws') + '/ws/nodes?id=' + encodeURIComponent(deviceId.identifier) + '&name=' + encodeURIComponent(settings.deviceName || 'Mobile Node') + '&token=' + encodeURIComponent(settings.apiKey || '');

            const socket = new WebSocket(wsUrl);
            this.ws = socket;

            socket.onopen = () => {
                this.reconnectDelayMs = RECONNECT_MIN_MS;
                logger.log('info', '[NodeWorker] Neural link established with server cluster');
            };

            socket.onmessage = async (event) => {
                try {
                    let rawData = '';
                    if (typeof event.data === 'string') {
                        rawData = event.data;
                    } else if (event.data instanceof Blob) {
                        rawData = await event.data.text();
                    } else if (event.data instanceof ArrayBuffer) {
                        rawData = new TextDecoder().decode(event.data);
                    }

                    logger.log('debug', `[NodeWorker] Raw message received (len: ${rawData.length}): ${rawData.substring(0, 50)}...`);
                    
                    const data = JSON.parse(rawData);
                    logger.log('debug', `[NodeWorker] Parsed message type: ${data.type}`);
                    
                    if (data.type === 'task' && data.id) {
                        logger.log('info', `[NodeWorker] STARTING task ${data.id}. Payload: ${JSON.stringify(data.payload).substring(0, 50)}...`);
                        this.updateStatus(true);
                        
                        const taskId = data.id;
                        const start = Date.now();
                        
                        // Create abort controller for this specific task
                        this.activeTaskAbort = new AbortController();

                        try {
                            const prompt = data.payload?.prompt || '';
                            
                            let fullResponse = '';
                            let chunkCount = 0;

                            const activeLlmConfig = this.llmConfig || {
                                provider: 'native-gguf',
                                type: 'gguf',
                                maxTokens: 1024,
                                temperature: 0.7,
                                top_k: 40,
                                top_p: 0.9,
                                nThreads: 6
                            };

                            const workerConfig = {
                                ...activeLlmConfig,
                                enableSearch: data.payload.options?.searchEnabled || false,
                                enableToolCalling: false,
                                enableThinking: data.payload.options?.thinking || false,
                                serverSideAgenticEnabled: false,
                            } as any;

                            logger.log('info', `[NodeWorker] Executing with provider=${workerConfig.provider}, model=${workerConfig.nativeModelPath || workerConfig.liteRTModelPath || 'default'}`);

                            // Execute using local LLM engine stream with abort signal
                            const stream = generateTextResponseStream(
                                [{ role: 'user', text: prompt, id: 'task', timestamp: new Date() } as any],
                                (this.personality || {}) as any,
                                workerConfig,
                                [],
                                undefined,
                                this.activeTaskAbort.signal
                            );

                            for await (const chunk of stream) {
                                if (this.activeTaskAbort?.signal.aborted) {
                                    console.log(`[NodeWorker] Task ${taskId} aborted locally during stream`);
                                    break;
                                }

                                if (typeof chunk === 'string') {
                                    fullResponse += chunk;
                                    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                                        this.ws.send(JSON.stringify({ type: 'token', id: taskId, token: chunk }));
                                    }
                                } else if (chunk.type === 'text') {
                                    fullResponse += chunk.content;
                                    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                                        this.ws.send(JSON.stringify({ type: 'token', id: taskId, token: chunk.content }));
                                    }
                                } else if (chunk.type === 'thinking') {
                                    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                                        this.ws.send(JSON.stringify({ type: 'thinking', id: taskId, content: chunk.content }));
                                    }
                                }

                                chunkCount++;
                                if (chunkCount % 20 === 0) {
                                    console.log(`[NodeWorker] Generated ${chunkCount} tokens for ${taskId}...`);
                                }
                            }

                            if (!this.activeTaskAbort?.signal.aborted && this.ws && this.ws.readyState === WebSocket.OPEN) {
                                console.log(`[NodeWorker] Task ${taskId} completed in ${Date.now() - start}ms. Sending final result.`);
                                this.ws.send(JSON.stringify({
                                    type: 'result',
                                    id: taskId,
                                    reply: fullResponse,
                                    durationMs: Date.now() - start,
                                    node: this.serverSettings?.deviceName || 'Mobile Node'
                                }));

                                // Persist KV cache after each task so context survives between remote requests
                                this.flushCache().catch(e =>
                                    logger.log('warn', '[NodeWorker] Failed to persist KV cache after task:', e)
                                );
                            }
                        } catch (taskError: any) {
                            if (this.activeTaskAbort?.signal.aborted) {
                                logger.log('info', `[NodeWorker] Task ${taskId} cleanup after abort`);
                            } else {
                                logger.log('error', `[NodeWorker] Task ${taskId} execution failed: ${taskError?.message}`, taskError);
                                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                                    this.ws.send(JSON.stringify({
                                        type: 'result',
                                        id: taskId,
                                        error: `WORKER_EXECUTION_FAILED: ${taskError?.message || 'Unknown error'}`,
                                        durationMs: Date.now() - start
                                    }));
                                }
                            }
                        } finally {
                            this.activeTaskAbort = null;
                            this.updateStatus(false);
                        }
                    } else if (data.type === 'ABORT_TASK' && data.id) {
                        logger.log('warn', `[NodeWorker] Received ABORT_TASK for ${data.id}`);
                        if (this.activeTaskAbort) {
                            this.activeTaskAbort.abort();
                        }
                    }
                } catch (e) {
                    this.updateStatus(false);
                    logger.log('error', '[NodeWorker] Message parsing failed', e);
                }
            };

            socket.onclose = () => {
                if (this.ws !== socket) return; // replaced or stopped
                this.ws = null;
                this.scheduleReconnect();
            };

            socket.onerror = (e) => {
                logger.log('error', '[NodeWorker] WebSocket error', e);
            };
        } catch (e) {
            logger.log('error', '[NodeWorker] Connection failed', e);
            this.scheduleReconnect();
        } finally {
            this.connecting = false;
        }
    }
}

export const nodeWorker = new MobileNodeWorker();
