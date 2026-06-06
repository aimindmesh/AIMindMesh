import { GoogleAuth } from 'google-auth-library';
import { readFileSync, existsSync } from 'fs';
import db from '../db/sqlite';
import crypto from 'crypto';
import { Logger } from '../utils/Logger';
import { config } from '../config';

export interface FCMPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}
const SERVICE_ACCOUNT_PATH = config.fcm?.serviceAccountPath ?? './firebase-service-account.json';

// Lazy init — nothing runs at module load time
let _auth: GoogleAuth | null = null;
let _fcmUrl: string | null = null;

function getFCMClient(): { auth: GoogleAuth; fcmUrl: string } {
  if (_auth && _fcmUrl) return { auth: _auth, fcmUrl: _fcmUrl };

  if (!existsSync(SERVICE_ACCOUNT_PATH)) {
    throw new Error(
      `[FCM] Service account file not found at "${SERVICE_ACCOUNT_PATH}". ` +
      `FCM notifications are disabled. Place your firebase-service-account.json ` +
      `in the project root or set FIREBASE_SERVICE_ACCOUNT_PATH in your .env`
    );
  }

  const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));

  _auth = new GoogleAuth({
    keyFile: SERVICE_ACCOUNT_PATH,
    scopes: ['https://www.googleapis.com/auth/firebase.messaging']
  });

  _fcmUrl = `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`;

  return { auth: _auth, fcmUrl: _fcmUrl };
}

async function getAccessToken(): Promise<string> {
  const { auth } = getFCMClient();
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  return tokenResponse.token!;
}

export function isConfigured(): { configured: boolean; path: string } {
  return {
    configured: existsSync(SERVICE_ACCOUNT_PATH),
    path: SERVICE_ACCOUNT_PATH
  };
}

export async function sendToDevice(fcmToken: string, payload: FCMPayload): Promise<void> {
  const logId = crypto.randomUUID();
  let fcmUrl: string;
  
  try {
    const client = getFCMClient();
    fcmUrl = client.fcmUrl;
  } catch (e) {
    Logger.warn('FCM', (e as Error).message);
    return; // FCM not configured, skip silently
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const accessToken = await getAccessToken();

    const body = {
      message: {
        token: fcmToken,
        notification: {
          title: payload.title,
          body: payload.body
        },
        data: payload.data ?? {},
        android: {
          priority: 'high'
        }
      }
    };

    Logger.debug('FCM', 'Synaptic pulse dispatching', body);
    const response = await fetch(fcmUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal as any
    });

    const resData = await response.json() as any;
    
    if (response.ok) {
      Logger.info('FCM', `Notification delivered to ${fcmToken.substring(0, 10)}...: ${payload.title}`);
      db.prepare(`INSERT INTO fcm_logs (id, status, recipient, message, timestamp) VALUES (?, ?, ?, ?, ?)`).run(
        logId, 'SUCCESS', fcmToken.substring(0, 20) + '...', payload.title, Date.now()
      );
    } else {
       db.prepare(`INSERT INTO fcm_logs (id, status, recipient, message, timestamp) VALUES (?, ?, ?, ?, ?)`).run(
        logId, 'FAILED', fcmToken.substring(0, 20) + '...', `Error: ${resData.error?.message || response.statusText}`, Date.now()
      );
    }
  } catch (err: any) {
    if (err.name === 'AbortError') err.message = 'FCM request timed out (15s)';
    Logger.error('FCM', `Dispatch failure: ${err.message}`);
    db.prepare(`INSERT INTO fcm_logs (id, status, recipient, message, timestamp) VALUES (?, ?, ?, ?, ?)`).run(
      logId, 'FAILED', fcmToken.substring(0, 20) + '...', `Exception: ${err.message}`, Date.now()
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendMulticast(title: string, body: string, data?: Record<string, string>): Promise<void> {
  const stmt = db.prepare('SELECT fcm_token FROM nodes WHERE fcm_token IS NOT NULL');
  const rows = stmt.all() as { fcm_token: string }[];
  const tokens = Array.from(new Set(rows.map(r => r.fcm_token)));

  Logger.info('FCM', `Dispatching multicast Synaptic Pulse to ${tokens.length} unique nodes: ${title}`);
  
  const promises = tokens.map(token => sendToDevice(token, { title, body, data }));
  await Promise.allSettled(promises);
}