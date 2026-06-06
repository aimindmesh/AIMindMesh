import { logger } from '../logger';
import { Device } from '@capacitor/device';
import { AIMindMeshServerSettings, LLMConfig, Personality } from '../../types';
import { generateTextResponseStream } from '../llm/llmService';
import { App } from '@capacitor/app';
import { saveNativeKvCache } from '../llm/nativeLLM';
import { saveLiteRTKvCache } from '../llm/providers/liteRT/plugin';


class MobileNodeWorker {
    private ws: WebSocket | null = null;
    private serverSettings: AIMindMeshServerSettings | null = null;
    private llmConfig: LLMConfig | null = null;
    private personality: Personality | null = null;
    private reconnectTimer: any = null;
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

    public init(settings: AIMindMeshServerSettings, llmConfig?: LLMConfig, personality?: Personality) {
        this.serverSettings = settings;
        if (llmConfig) this.llmConfig = llmConfig;
        if (personality) this.personality = personality;
        this.connect();
        
        // Survival logging: verify if worker is alive and logging is working
        setInterval(() => {
            logger.log('debug', `[NodeWorker] SURVIVAL CHECK - Status: ${this.isWorking ? 'BUSY' : 'IDLE'}, WS: ${this.ws?.readyState}`);
        }, 5000);

        // [KV CACHE] Persistence trigger: flush to disk when app goes to background
        App.addListener('appStateChange', async ({ isActive }) => {
            if (!isActive) {
                logger.log('info', '[NodeWorker] App backgrounding. Flushing KV cache to disk...');
                await this.flushCache();
            }
        });
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
        this.serverSettings = null;
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    public async connect() {
        if (!this.serverSettings || !this.serverSettings.enabled || !this.serverSettings.serverUrl) return;
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;

        const deviceId = await Device.getId();
        const wsUrl = this.serverSettings.serverUrl.replace(/^http/, 'ws') + '/ws/nodes?id=' + encodeURIComponent(deviceId.identifier) + '&name=' + encodeURIComponent(this.serverSettings.deviceName || 'Mobile Node');
        
        try {
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                logger.log('info', '[NodeWorker] Neural link established with server cluster');
            };

            this.ws.onmessage = async (event) => {
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

            this.ws.onclose = () => {
                logger.log('warn', '[NodeWorker] Neural link closed, reconnecting in 2s...');
                if (this.serverSettings) {
                    this.reconnectTimer = setTimeout(() => this.connect(), 2000);
                }
            };

            this.ws.onerror = (e) => {
                logger.log('error', '[NodeWorker] WebSocket error', e);
            };
        } catch (e) {
            logger.log('error', '[NodeWorker] Connection failed', e);
        }
    }
}

export const nodeWorker = new MobileNodeWorker();
