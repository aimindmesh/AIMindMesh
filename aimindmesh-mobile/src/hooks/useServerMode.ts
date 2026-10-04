/**
 * useServerMode.ts (v4.0.0)
 * Manages AIMindMesh Server integration lifecycle:
 *  - FCM initialization when server is enabled
 *  - Periodic heartbeat to detect server availability
 *  - ProactiveService server-mode switching (suspend/resume local engine)
 *  - Worker node participation (follows its toggle without waiting for a reconnect)
 *  - Emits banner events for UI feedback
 */

import { useEffect, useRef, useState } from 'react';
import { AIMindMeshServerSettings, LLMConfig, Personality, ProactiveSettings } from '../types';
import { Device } from '@capacitor/device';
import { initFCMService, refreshFCMRegistration } from '../services/fcmService';
import { proactiveService } from '../services/proactive/ProactiveService';
import { logger } from '../services/logger';
import { nodeWorker } from '../services/worker/NodeWorker';
import { syncNativeServerConfig } from '../services/proactive/nativeServerConfig';
import { updateDeviceSettings } from '../services/llm/providers/serverProvider';

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

// ─── Registration helper ───────────────────────────────────────────────────
async function registerWithServer(settings: AIMindMeshServerSettings): Promise<void> {
    try {
        await fetch(`${settings.serverUrl}/api/nodes/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': settings.apiKey
            },
            body: JSON.stringify({
                id: (await Device.getId()).identifier,
                name: settings.deviceName || 'Mobile Device',
                type: 'mobile',
                models: ['litert', 'native-gguf'] // Capability hints
            }),
            signal: AbortSignal.timeout(5000)
        });
    } catch (e) {
        logger.log('warn', '[ServerMode] Registration failed', e);
    }
}

// ─── Ping helper ──────────────────────────────────────────────────────────
async function pingServer(settings: AIMindMeshServerSettings): Promise<boolean> {
    if (!settings.enabled || !settings.serverUrl) return false;
    try {
        const resp = await fetch(`${settings.serverUrl}/api/health`, {
            headers: { 'x-api-key': settings.apiKey },
            signal: AbortSignal.timeout(5000)
        });
        if (resp.ok) {
            // Periodically re-register to ensure node visibility in dashboard
            await registerWithServer(settings);
            return true;
        }
        return false;
    } catch {
        return false;
    }
}

export function useServerMode({
    serverSettings,
    proactiveSettings,
    llmConfig,
    personality,
    onServerOnline,
    onServerOffline,
}: UseServerModeOptions): void {
    // The native proactive worker needs the server settings too (contextual delivery)
    useEffect(() => {
        void syncNativeServerConfig(serverSettings);
    }, [serverSettings.enabled, serverSettings.serverUrl, serverSettings.deliveryMode, serverSettings.apiKey]);

    // Latest values for the long-lived heartbeat and worker (no restart when they change)
    const settingsRef = useRef(serverSettings);
    settingsRef.current = serverSettings;
    const callbacksRef = useRef({ onServerOnline, onServerOffline });
    callbacksRef.current = { onServerOnline, onServerOffline };
    const workerConfigRef = useRef({ llmConfig, personality });
    workerConfigRef.current = { llmConfig, personality };

    const failureCount = useRef(0);
    const [isServerOnline, setIsServerOnline] = useState(false);
    const { enabled, serverUrl, apiKey, deviceName } = serverSettings;

    // ─── Connection: FCM, immediate ping, heartbeat ───────────────────────────
    // Restarted only when the connection itself changes (not on model/personality edits)
    useEffect(() => {
        if (!enabled || !serverUrl) {
            setIsServerOnline(false);
            return;
        }

        let cancelled = false;
        failureCount.current = 0;

        // Initialize FCM
        initFCMService(settingsRef.current).catch(e =>
            logger.log('warn', '[ServerMode] FCM init failed', e)
        );

        const check = async (startup: boolean) => {
            const alive = await pingServer(settingsRef.current);
            if (cancelled) return;

            if (alive) {
                if (failureCount.current > 0) {
                    logger.log('info', '[ServerMode] Server back online');
                }
                failureCount.current = 0;
                setIsServerOnline(true);
            } else if (startup) {
                logger.log('warn', '[ServerMode] Server unreachable on startup — local mode retained');
            } else {
                failureCount.current++;
                logger.log('warn', `[ServerMode] Ping failed (${failureCount.current}/${MAX_FAILURES_BEFORE_FALLBACK})`);
                if (failureCount.current >= MAX_FAILURES_BEFORE_FALLBACK) setIsServerOnline(false);
            }
        };

        // Do an immediate ping then start heartbeat
        void check(true);
        const heartbeat = setInterval(() => void check(false), HEARTBEAT_INTERVAL_MS);

        return () => {
            cancelled = true;
            clearInterval(heartbeat);
            // A new address or key is verified again before server mode resumes
            setIsServerOnline(false);
        };
    }, [enabled, serverUrl, apiKey, deviceName]);

    // ─── Online/offline transitions ───────────────────────────────────────────
    const wasOnline = useRef(false);
    useEffect(() => {
        if (isServerOnline === wasOnline.current) return;
        wasOnline.current = isServerOnline;
        if (isServerOnline) {
            callbacksRef.current.onServerOnline?.();
            logger.log('info', '[ServerMode] Switched to server mode');
        } else {
            callbacksRef.current.onServerOffline?.();
            logger.log('warn', '[ServerMode] Switched to local fallback mode');
        }
    }, [isServerOnline]);

    // ─── Enforce Proactive Source Preference ──────────────────────────────────
    useEffect(() => {
        if (isServerOnline && enabled && proactiveSettings.source !== 'local') {
            logger.log('info', '[ServerMode] Proactive Source set to Auto (Server) — enabling server insight reception');
            proactiveService.enableServerMode(settingsRef.current);
        } else {
            if (isServerOnline && proactiveSettings.source === 'local') {
                logger.log('info', '[ServerMode] Proactive Source is strictly Local — disabled server insight reception');
            }
            proactiveService.disableServerMode();
        }
    }, [isServerOnline, enabled, proactiveSettings.source]);

    // ─── Delivery preferences on the server: mode, quiet hours, time zone ─────
    // The server holds its pushes back in the user's quiet hours, in the phone's time zone
    const deliveryMode = serverSettings.deliveryMode ?? 'PUSH';
    const quietHours = proactiveSettings.quietHours;
    const quietKey = JSON.stringify(quietHours ?? null);
    useEffect(() => {
        if (!isServerOnline || !enabled) return;
        updateDeviceSettings(settingsRef.current, {
            deliveryMode,
            quietHours: quietHours ? { enabled: !!quietHours.enabled, start: quietHours.start, end: quietHours.end } : undefined,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }).catch(e => logger.log('warn', '[ServerMode] Delivery settings sync failed', e));
    }, [isServerOnline, enabled, deliveryMode, quietKey]); // eslint-disable-line react-hooks/exhaustive-deps

    // ─── Worker node: follows its toggle and the server state ────────────────
    const participateAsWorker = !!serverSettings.participateAsWorker;
    useEffect(() => {
        if (isServerOnline && enabled && participateAsWorker) {
            const { llmConfig: config, personality: persona } = workerConfigRef.current;
            nodeWorker.init(settingsRef.current, config, persona);
        } else {
            nodeWorker.stop();
        }
    }, [isServerOnline, enabled, participateAsWorker, serverUrl, apiKey, deviceName]);

    // Remote tasks use the current model and personality, without reconnecting
    useEffect(() => {
        nodeWorker.updateConfig(llmConfig, personality);
    }, [llmConfig, personality]);

    // ─── Token refresh when settings change ───────────────────────────────────
    useEffect(() => {
        if (serverSettings.enabled && serverSettings.serverUrl && serverSettings.apiKey) {
            refreshFCMRegistration(serverSettings).catch(() => { });
        }
    }, [serverSettings.serverUrl, serverSettings.apiKey]);
}
