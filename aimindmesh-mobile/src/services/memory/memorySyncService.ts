/**
 * memorySyncService.ts
 * Facts mirrored to the AIMindMesh Server knowledge graph (when "auto-sync new memories" is on):
 * each fact is upserted by its id (no duplicates), and deleted on the server when the user
 * deletes it or it stops holding (replaced, done, expired).
 */

import { AIMindMeshServerSettings } from '../../types';
import { logger } from '../logger';
import { Fact } from './facts/factTypes';
import { FactChange, factStore } from './facts/factStore';

const TIMEOUT_MS = 10000;

const usable = (settings: AIMindMeshServerSettings | null | undefined): settings is AIMindMeshServerSettings =>
    !!settings?.enabled && !!settings.serverUrl && !!settings.apiKey;

const headers = (settings: AIMindMeshServerSettings) => ({ 'Content-Type': 'application/json', 'x-api-key': settings.apiKey });

export function factToServerPayload(fact: Fact) {
    return {
        id: fact.id,
        content: fact.subject ? `${fact.subject}: ${fact.content}` : fact.content,
        category: fact.kind,
        source: 'aimindmesh_android',
        createdAt: new Date(fact.createdAt).toISOString(),
    };
}

export async function pushFactToServer(fact: Fact, settings: AIMindMeshServerSettings): Promise<boolean> {
    const resp = await fetch(`${settings.serverUrl}/api/kg/memories`, {
        method: 'POST', headers: headers(settings), body: JSON.stringify(factToServerPayload(fact)),
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return resp.ok;
}

export async function deleteFactOnServer(id: string, settings: AIMindMeshServerSettings): Promise<boolean> {
    const resp = await fetch(`${settings.serverUrl}/api/kg/memories/${encodeURIComponent(id)}`, {
        method: 'DELETE', headers: headers(settings), signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return resp.ok;
}

async function applyChange(change: FactChange, settings: AIMindMeshServerSettings): Promise<void> {
    if (change.type === 'clear') {
        logger.log('info', '[MemorySync] Local facts cleared: the server copies stay (delete them from the server admin)');
        return;
    }
    const jobs: Array<() => Promise<boolean>> = change.type === 'remove'
        ? change.ids.map(id => () => deleteFactOnServer(id, settings))
        : change.facts.map(f => () => f.status === 'active' ? pushFactToServer(f, settings) : deleteFactOnServer(f.id, settings));
    for (const job of jobs) {
        try {
            if (!(await job())) logger.log('warn', '[MemorySync] Server refused a fact change');
        } catch (e) {
            logger.log('warn', '[MemorySync] Fact sync failed', e);
        }
        // Yield to the UI between requests (a migration can bring many facts at once)
        await new Promise(r => setTimeout(r, 0));
    }
}

/**
 * Mirrors every later fact change to the server while `getSettings()` returns usable settings.
 * Returns the unsubscribe function.
 */
export function startFactSync(getSettings: () => AIMindMeshServerSettings | null): () => void {
    return factStore.onChange(change => {
        const settings = getSettings();
        if (usable(settings)) void applyChange(change, settings);
    });
}
