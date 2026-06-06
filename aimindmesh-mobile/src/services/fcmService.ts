/**
 * fcmService.ts (v4.1.0)
 * FCM token lifecycle manager.
 * - Registers device token with AIMindMesh Server on EVERY startup (not just first)
 * - Refreshes token when FCM rotates it
 * - Routes incoming foreground messages to appropriate handlers
 * - Enforces Quiet Hours for in-app foreground FCM notifications
 */

import { registerPlugin, PluginListenerHandle } from '@capacitor/core';
import { Device } from '@capacitor/device';
import { logger } from './logger';
import { AIMindMeshServerSettings } from '../types';
import { nodeWorker } from './worker/NodeWorker';

// ─── Capacitor Plugin Bridge ──────────────────────────────────────────────────

export interface FCMMessage {
    type: 'NEW_INSIGHT' | 'INGESTION_COMPLETE' | 'NODE_STATUS' | 'SYSTEM_ALERT' | 'MARK_READ_ACTION' | 'WAKE_FOR_INFERENCE' | 'SYNC_REQUEST';
    title: string;
    body: string;
    data: Record<string, string>;
}

export interface FCMPlugin {
    getFCMToken(): Promise<{ token: string }>;
    requestPermission(): Promise<{ granted: boolean }>;
    addListener(event: 'fcm:message', handler: (data: FCMMessage) => void): Promise<PluginListenerHandle>;
    addListener(event: 'fcm:tokenRefresh', handler: (data: { token: string }) => void): Promise<PluginListenerHandle>;
}

export const FCMCapacitor = registerPlugin<FCMPlugin>('FCMCapacitor');

// ─── Internal event bus ───────────────────────────────────────────────────────

type FeedEvent = {
    type: 'new_insight';
    insightId?: string;
    title: string;
    body: string;
} | {
    type: 'ingestion_complete';
    jobId?: string;
} | {
    type: 'mark_read';
    insightId: string;
};

type FeedListener = (event: FeedEvent) => void;
const feedListeners = new Set<FeedListener>();

export function onFCMFeedEvent(cb: FeedListener): () => void {
    feedListeners.add(cb);
    return () => feedListeners.delete(cb);
}

function emitFeedEvent(event: FeedEvent) {
    feedListeners.forEach(cb => cb(event));
}

// ─── Quiet Hours Check ────────────────────────────────────────────────────────

/**
 * Returns true if the current time is within the user-configured quiet hours.
 * Reads proactive-settings from localStorage to respect the same setting used
 * for local proactive actions.
 */
function isQuietHoursActive(): boolean {
    try {
        const raw = localStorage.getItem('proactive-settings');
        if (!raw) return false;
        const settings = JSON.parse(raw);
        const qh = settings?.quietHours;
        if (!qh?.enabled) return false;

        const now = new Date();
        const hour = now.getHours();
        const min = now.getMinutes();
        // Treat time as fractional hour for comparison
        const currentH = hour + min / 60;

        const parseH = (str: string) => {
            const [h, m] = str.split(':').map(Number);
            return h + (m || 0) / 60;
        };

        const startH = parseH(qh.start ?? '22:00');
        const endH = parseH(qh.end ?? '08:00');

        // Cross-midnight window (e.g. 22:00 → 08:00)
        if (startH > endH) {
            return currentH >= startH || currentH < endH;
        }
        // Same-day window (e.g. 09:00 → 17:00)
        return currentH >= startH && currentH < endH;
    } catch {
        return false;
    }
}

// ─── Token Registration ───────────────────────────────────────────────────────
/**
 * Manual trigger for token registration (e.g. from Settings UI)
 */
export async function forceRegisterToken(serverSettings: AIMindMeshServerSettings): Promise<void> {
    try {
        const { token } = await FCMCapacitor.getFCMToken();
        await registerTokenWithServer(token, serverSettings);
        logger.log('info', '[FCMService] Manual token re-registration successful');
    } catch (e) {
        logger.log('error', '[FCMService] Manual token registration failed', e);
        throw e;
    }
}

async function registerTokenWithServer(
    token: string,
    serverSettings: AIMindMeshServerSettings
): Promise<void> {
    if (!serverSettings.enabled || !serverSettings.serverUrl) return;
    try {
        const deviceId = await Device.getId();
        const resp = await fetch(`${serverSettings.serverUrl}/api/nodes/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': serverSettings.apiKey
            },
            body: JSON.stringify({
                id: deviceId.identifier,
                name: serverSettings.deviceName || 'Mobile Device',
                type: 'mobile',
                fcmToken: token,
                platform: 'android',
                last_heartbeat: Date.now()
            }),
            signal: AbortSignal.timeout(10000)
        });
        if (resp.ok) {
            logger.log('info', '[FCMService] Token registered with server');
        } else {
            logger.log('warn', `[FCMService] Token registration failed: ${resp.status}`);
        }
    } catch (e) {
        logger.log('warn', '[FCMService] Token registration error', e);
    }
}

// ─── Message Dispatcher ───────────────────────────────────────────────────────

function dispatchMessage(msg: FCMMessage) {
    logger.log('info', `[FCMService] FCM message: type=${msg.type} title="${msg.title}"`);

    // Enforce quiet hours for foreground in-app notifications.
    // NOTE: Background/killed-app FCM notifications delivered by the OS tray
    // are NOT suppressible here — they are handled by the FCM SDK natively.
    // Quiet hours suppression only applies to the foreground in-app event bus.
    if (isQuietHoursActive()) {
        logger.log('info', `[FCMService] Quiet hours active — suppressing foreground FCM event: ${msg.type}`);
        return;
    }

    switch (msg.type) {
        case 'NEW_INSIGHT':
            emitFeedEvent({
                type: 'new_insight',
                insightId: msg.data.insightId,
                title: msg.title,
                body: msg.body
            });
            break;
        case 'INGESTION_COMPLETE':
            emitFeedEvent({ type: 'ingestion_complete', jobId: msg.data.jobId });
            break;
        case 'MARK_READ_ACTION':
            if (msg.data.insightId) {
                emitFeedEvent({ type: 'mark_read', insightId: msg.data.insightId });
            }
            break;
        case 'WAKE_FOR_INFERENCE':
            logger.log('info', '[FCMService] Received Wakeup Call for inference task');
            nodeWorker.connect();
            break;
        case 'SYNC_REQUEST':
            logger.log('info', '[FCMService] Received Sync Request from server');
            // We'll import GlobalSyncService later to avoid circular dependency if any
            import('./GlobalSyncService').then(m => m.GlobalSyncService.performSync()).catch(e => {
                logger.log('error', '[FCMService] Sync trigger failed', e);
            });
            break;
        default:
            logger.log('debug', '[FCMService] Unhandled FCM type:', msg.type);
    }
}

// ─── Initialization ───────────────────────────────────────────────────────────

/**
 * Set to true once listeners are attached (they survive the full app lifecycle).
 * Token registration is always re-attempted on init (not gated by this flag).
 */
let _listenersAttached = false;

/**
 * Call once each time the server settings are activated (app startup or re-enable).
 * Always re-registers the FCM token with the server to guarantee visibility.
 * Attaches event listeners only once.
 */
export async function initFCMService(serverSettings: AIMindMeshServerSettings): Promise<void> {
    // Only on Android with Capacitor native layer
    if (typeof (window as any).Capacitor === 'undefined') {
        logger.log('info', '[FCMService] Not on native — FCM skipped');
        return;
    }

    try {
        // 1. Request notification permission (Android 13+)
        const { granted } = await FCMCapacitor.requestPermission();
        logger.log('info', `[FCMService] Notification permission: ${granted}`);

        // 2. Get token and ALWAYS re-register with server.
        //    Firebase SDK caches the token locally; this fetch is fast.
        //    Re-registration ensures the server has the latest token even
        //    after app restarts or server reinstalls.
        const { token } = await FCMCapacitor.getFCMToken();
        logger.log('info', `[FCMService] FCM token obtained (${token.substring(0, 10)}...)`);
        await registerTokenWithServer(token, serverSettings);

        if (!_listenersAttached) {
            // 3. Listen for token refreshes (FCM rotates tokens periodically)
            await FCMCapacitor.addListener('fcm:tokenRefresh', async ({ token: newToken }) => {
                logger.log('info', '[FCMService] Token refreshed — re-registering');
                await registerTokenWithServer(newToken, serverSettings);
            });

            // 4. Listen for foreground messages (app open)
            await FCMCapacitor.addListener('fcm:message', dispatchMessage);

            _listenersAttached = true;
        }

        logger.log('info', '[FCMService] Initialized (token registered)');
    } catch (e) {
        logger.log('error', '[FCMService] Initialization failed', e);
    }
}

/** Re-registers token if server settings change (e.g. URL or API key updated) */
export async function refreshFCMRegistration(serverSettings: AIMindMeshServerSettings): Promise<void> {
    try {
        const { token } = await FCMCapacitor.getFCMToken();
        await registerTokenWithServer(token, serverSettings);
    } catch (e) {
        logger.log('warn', '[FCMService] Token refresh registration failed', e);
    }
}
