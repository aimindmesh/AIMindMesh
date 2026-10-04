/**
 * Delegation of the web tools to the AIMindMesh Server (Settings → AIMindMesh Server →
 * Web tools). Reads the same settings the app saves, with the API key from the secret store.
 */

import { CapacitorHttp } from '@capacitor/core';
import { readSetting } from '../security/secretStore';
import { DEFAULT_AIMINDMESH_SERVER_SETTINGS, type AIMindMeshServerSettings } from '../../types';

export type WebDelegationFeature = 'search' | 'scraping' | 'analysis';

const FEATURE_FLAG: Record<WebDelegationFeature, keyof AIMindMeshServerSettings> = {
    search: 'delegateWebSearch',
    scraping: 'delegateWebScraping',
    analysis: 'delegateWebAnalysis',
};

export interface WebDelegation {
    baseUrl: string;
    apiKey: string;
}

/** Server to delegate the feature to, or null when the server or the feature is off. */
export function getWebDelegation(feature: WebDelegationFeature): WebDelegation | null {
    const settings = readSetting<AIMindMeshServerSettings>('aimindmesh-server-settings', DEFAULT_AIMINDMESH_SERVER_SETTINGS);
    if (!settings?.enabled || !settings[FEATURE_FLAG[feature]] || !settings.serverUrl) return null;
    return { baseUrl: settings.serverUrl.replace(/\/+$/, ''), apiKey: settings.apiKey || '' };
}

/** POST to the server's web API; the parsed body of a 200 reply, else an error. */
export async function postToServer<T>(
    delegation: WebDelegation,
    path: string,
    data: Record<string, unknown>,
    readTimeout: number,
): Promise<T> {
    const response = await CapacitorHttp.request({
        method: 'POST',
        url: `${delegation.baseUrl}${path}`,
        headers: { 'Content-Type': 'application/json', 'x-api-key': delegation.apiKey },
        data,
        connectTimeout: 8000,
        readTimeout,
    });
    const body = typeof response.data === 'string' ? safeJson(response.data) : response.data;
    if (response.status !== 200) {
        throw new Error(body?.error || `HTTP ${response.status}`);
    }
    return body as T;
}

function safeJson(text: string): any {
    try {
        return JSON.parse(text);
    } catch {
        return { error: text.slice(0, 200) };
    }
}
