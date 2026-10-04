import { logger } from '../logger';
import { Device } from '@capacitor/device';
import { PluginListenerHandle } from '@capacitor/core';
import { AIMindMeshServerSettings, LLMConfig, Personality } from '../../types';
import { generateTextResponseStream } from '../llm/llmService';
import { App } from '@capacitor/app';
import { saveNativeKvCache } from '../llm/nativeLLM';
import { saveLiteRTKvCache } from '../llm/providers/liteRT/plugin';
import { asBackgroundTask, asInternalTask } from '../llm/background/taskFlags';
import { runExclusiveBackground } from '../llm/background/llmArbiter';

/** Reconnect delay after a closed link: doubles up to the maximum, reset once connected */
export const RECONNECT_MIN_MS = 2_000;
export const RECONNECT_MAX_MS = 60_000;

/** What identifies the server link: a change means reconnecting */
const connectionKey = (s: AIMindMeshServerSettings) => `${s.serverUrl}|${s.apiKey}|${s.deviceName ?? ''}`;

class MobileNodeWorker {
    private ws: WebSocket | null = null;
    private serverSettings: AIMindMeshServerSettings | null = null;
    /** Settings of the last init(), kept by stop(): a server push can wake the worker */
    private lastSettings: AIMindMeshServerSettings | null = null;
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
        this.lastSettings = settings;
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

    /**
     * WAKE_FOR_INFERENCE push: the server has a task for this device. Reconnects with the last
     * settings even after stop() (e.g. the heartbeat gave up while Doze cut the network).
     */
    public wake() {
        if (this.serverSettings) {
            void this.connect();
        } else if (this.lastSettings?.enabled && this.lastSettings.participateAsWorker) {
            logger.log('info', '[NodeWorker] Woken by the server: reconnecting');
            this.init(this.lastSettings);
        }
    }

    private send(message: Record<string, unknown>) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
    }

    /**
     * Runs a mesh task as a background generation: it never interrupts the owner's chat (the
     * chat interrupts it, and the server gets an error to route it elsewhere), and it gets no
     * memories or documents of the owner (internal task: only the persona's instructions).
     */
    private async runTask(taskId: string, payload: { prompt?: string; options?: { searchEnabled?: boolean; thinking?: boolean } }) {
        logger.log('info', `[NodeWorker] STARTING task ${taskId}. Payload: ${JSON.stringify(payload).substring(0, 50)}...`);
        const start = Date.now();
        const activeLlmConfig = this.llmConfig || ({ provider: 'native-gguf', nThreads: 6 } as LLMConfig);
        const workerConfig = asBackgroundTask(asInternalTask({
            ...activeLlmConfig,
            enableSearch: payload.options?.searchEnabled || false,
            enableToolCalling: false,
            enableThinking: payload.options?.thinking || false,
            enableSemanticMemory: false,
        } as LLMConfig));
        const persona: Personality = { name: this.personality?.name || 'Assistant', description: '', systemPrompt: this.personality?.systemPrompt || '', traits: [] };

        this.updateStatus(true);
        let preempted = false;
        try {
            const ran = await runExclusiveBackground(`mesh task ${taskId}`, async (arbiterSignal) => {
                // Aborted by the server (ABORT_TASK) or by the owner's chat (arbiter)
                const abort = new AbortController();
                this.activeTaskAbort = abort;
                arbiterSignal.addEventListener('abort', () => { preempted = true; abort.abort(); }, { once: true });
                logger.log('info', `[NodeWorker] Executing with provider=${workerConfig.provider}, model=${workerConfig.nativeModelPath || workerConfig.liteRTModelPath || 'default'}`);

                let fullResponse = '';
                const stream = generateTextResponseStream(
                    [{ role: 'user', text: payload.prompt || '', id: 'task', timestamp: new Date() }],
                    persona, workerConfig, undefined, abort.signal
                );
                for await (const chunk of stream) {
                    if (abort.signal.aborted) break;
                    if (typeof chunk === 'string') {
                        fullResponse += chunk;
                        this.send({ type: 'token', id: taskId, token: chunk });
                    } else if (chunk.type === 'text') {
                        fullResponse += chunk.content;
                        this.send({ type: 'token', id: taskId, token: chunk.content });
                    } else if (chunk.type === 'thinking') {
                        this.send({ type: 'thinking', id: taskId, content: chunk.content });
                    }
                }
                return abort.signal.aborted ? null : fullResponse;
            }, workerConfig.provider);

            if (preempted || ran === null) {
                // Busy with (or interrupted by) the owner's chat: the server routes the task elsewhere
                this.send({ type: 'result', id: taskId, error: 'WORKER_BUSY: the device is answering its owner', durationMs: Date.now() - start });
                return;
            }
            logger.log('info', `[NodeWorker] Task ${taskId} completed in ${Date.now() - start}ms. Sending final result.`);
            this.send({ type: 'result', id: taskId, reply: ran, durationMs: Date.now() - start, node: this.serverSettings?.deviceName || 'Mobile Node' });
        } catch (taskError: any) {
            if (this.activeTaskAbort?.signal.aborted && !preempted) {
                logger.log('info', `[NodeWorker] Task ${taskId} cleanup after abort`);
            } else {
                logger.log('error', `[NodeWorker] Task ${taskId} execution failed: ${taskError?.message}`, taskError);
                this.send({ type: 'result', id: taskId, error: `WORKER_EXECUTION_FAILED: ${taskError?.message || 'Unknown error'}`, durationMs: Date.now() - start });
            }
        } finally {
            this.activeTaskAbort = null;
            this.updateStatus(false);
        }
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
                        await this.runTask(data.id, data.payload || {});
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
