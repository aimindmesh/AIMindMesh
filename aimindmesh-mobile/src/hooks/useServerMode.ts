/**
 * useServerMode.ts (v4.0.0)
 * Manages AIMindMesh Server integration lifecycle:
 *  - FCM initialization when server is enabled
 *  - Periodic heartbeat to detect server availability
 *  - ProactiveService server-mode switching (suspend/resume local engine)
 *  - Emits banner events for UI feedback
 */

import { useEffect, useRef, useCallback } from 'react';
import { AIMindMeshServerSettings, LLMConfig, Personality, ProactiveSettings } from '../types';
import { Device } from '@capacitor/device';
import { initFCMService, refreshFCMRegistration } from '../services/fcmService';
import { proactiveService } from '../services/proactive/ProactiveService';
import { logger } from '../services/logger';
import { nodeWorker } from '../services/worker/NodeWorker';

const HEARTBEAT_INTERVAL_MS = 60_000; // 1 minute
const MAX_FAILURES_BEFORE_FALLBACK = 3;

interface UseServerModeOptions {
    serverSettings: AIMindMeshServerSettings;
    proactiveSettings: ProactiveSettings;
    llmConfig?: LLMConfig;
    personality?: Personality;
    onServerOnline?: () => void;
    onServerOffline?: () => void;
}

export function useServerMode({
    serverSettings,
    proactiveSettings,
    llmConfig,
    personality,
    onServerOnline,
    onServerOffline,
}: UseServerModeOptions): void {
    const failureCount = useRef(0);
    const isServerModeActive = useRef(false);
    const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // ─── Registration helper ───────────────────────────────────────────────────
    const registerWithServer = useCallback(async (): Promise<void> => {
        if (!serverSettings.enabled || !serverSettings.serverUrl) return;
        try {
            await fetch(`${serverSettings.serverUrl}/api/nodes/register`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-api-key': serverSettings.apiKey 
                },
                body: JSON.stringify({
                    id: (await Device.getId()).identifier,
                    name: serverSettings.deviceName || 'Mobile Device',
                    type: 'mobile',
                    models: ['litert', 'native-gguf'] // Capability hints
                }),
                signal: AbortSignal.timeout(5000)
            });
        } catch (e) {
            logger.log('warn', '[ServerMode] Registration failed', e);
        }
    }, [serverSettings]);

    // ─── Ping helper ──────────────────────────────────────────────────────────
    const pingServer = useCallback(async (): Promise<boolean> => {
        if (!serverSettings.enabled || !serverSettings.serverUrl) return false;
        try {
            const resp = await fetch(`${serverSettings.serverUrl}/api/health`, {
                headers: { 'x-api-key': serverSettings.apiKey },
                signal: AbortSignal.timeout(5000)
            });
            if (resp.ok) {
                // Periodically re-register to ensure node visibility in dashboard
                await registerWithServer();
                return true;
            }
            return false;
        } catch {
            return false;
        }
    }, [serverSettings, registerWithServer]);

    // ─── Heartbeat loop ───────────────────────────────────────────────────────
    const startHeartbeat = useCallback(() => {
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);

        heartbeatRef.current = setInterval(async () => {
            if (!serverSettings.enabled) return;

            const alive = await pingServer();

            if (alive) {
                if (failureCount.current > 0) {
                    logger.log('info', '[ServerMode] Server back online');
                }
                failureCount.current = 0;

                if (!isServerModeActive.current) {
                    isServerModeActive.current = true;
                    if (proactiveSettings.source !== 'local') {
                        proactiveService.enableServerMode(serverSettings);
                    }
                    if (serverSettings.participateAsWorker) {
                        nodeWorker.init(serverSettings, llmConfig, personality);
                    } else {
                        nodeWorker.stop();
                    }
                    onServerOnline?.();
                    logger.log('info', '[ServerMode] Switched to server mode');
                }
            } else {
                failureCount.current++;
                logger.log('warn', `[ServerMode] Ping failed (${failureCount.current}/${MAX_FAILURES_BEFORE_FALLBACK})`);

                if (failureCount.current >= MAX_FAILURES_BEFORE_FALLBACK && isServerModeActive.current) {
                    isServerModeActive.current = false;
                    proactiveService.disableServerMode();
                    nodeWorker.stop();
                    onServerOffline?.();
                    logger.log('warn', '[ServerMode] Switched to local fallback mode');
                }
            }
        }, HEARTBEAT_INTERVAL_MS);
    }, [pingServer, serverSettings, onServerOnline, onServerOffline, llmConfig, personality]);

    // ─── Init ─────────────────────────────────────────────────────────────────
    useEffect(() => {
        if (!serverSettings.enabled || !serverSettings.serverUrl) {
            // If server gets disabled, restore local mode
            if (isServerModeActive.current) {
                isServerModeActive.current = false;
                proactiveService.disableServerMode();
                nodeWorker.stop();
            }
            if (heartbeatRef.current) {
                clearInterval(heartbeatRef.current);
                heartbeatRef.current = null;
            }
            return;
        }

        // Initialize FCM
        initFCMService(serverSettings).catch(e =>
            logger.log('warn', '[ServerMode] FCM init failed', e)
        );

        // Do an immediate ping then start heartbeat
        pingServer().then(alive => {
            if (alive) {
                failureCount.current = 0;
                isServerModeActive.current = true;
                if (proactiveSettings.source !== 'local') {
                    proactiveService.enableServerMode(serverSettings);
                }
                if (serverSettings.participateAsWorker) {
                    nodeWorker.init(serverSettings, llmConfig, personality);
                } else {
                    nodeWorker.stop();
                }
                onServerOnline?.();
                logger.log('info', '[ServerMode] Server reachable on startup — server mode active');
            } else {
                logger.log('warn', '[ServerMode] Server unreachable on startup — local mode retained');
            }
        });

        startHeartbeat();

        return () => {
            if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        };
    }, [serverSettings.enabled, serverSettings.serverUrl, serverSettings.apiKey, serverSettings.deviceName, llmConfig, personality]);

    // ─── Enforce Proactive Source Preference ──────────────────────────────────
    useEffect(() => {
        if (!isServerModeActive.current || !serverSettings.enabled) return;

        if (proactiveSettings.source === 'local') {
            logger.log('info', '[ServerMode] Proactive Source is strictly Local — disabled server insight reception');
            proactiveService.disableServerMode();
        } else {
            logger.log('info', '[ServerMode] Proactive Source set to Auto (Server) — enabling server insight reception');
            proactiveService.enableServerMode(serverSettings);
        }
    }, [proactiveSettings.source, serverSettings]);

    // ─── Token refresh when settings change ───────────────────────────────────
    useEffect(() => {
        if (serverSettings.enabled && serverSettings.serverUrl && serverSettings.apiKey) {
            refreshFCMRegistration(serverSettings).catch(() => { });
        }
    }, [serverSettings.serverUrl, serverSettings.apiKey]);
}
