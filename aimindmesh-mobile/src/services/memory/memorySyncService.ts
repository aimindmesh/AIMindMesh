/**
 * memorySyncService.ts (v4.0.0)
 * Bulk and incremental memory sync to the AIMindMesh Server KG.
 */

import { AIMindMeshServerSettings, Memory } from '../../types';
import { logger } from '../logger';

export interface SyncProgress {
    total: number;
    synced: number;
    failed: number;
    done: boolean;
}

type ProgressCallback = (p: SyncProgress) => void;

/**
 * Returns the approximate count of memories that would be synced.
 * Used to show the preview count in MemorySettings before bulk sync starts.
 */
export function getMemoryCount(memories: Memory[]): number {
    return memories.length;
}

/**
 * Bulk sync: posts each memory to POST /api/kg/memories.
 * Fire-and-forget per item; continues on failure.
 * @param memories - All local memories to sync
 * @param settings - Server configuration
 * @param onProgress - Called after each successful/failed POST
 */
export async function bulkSyncMemoriesToServer(
    memories: Memory[],
    settings: AIMindMeshServerSettings,
    onProgress?: ProgressCallback
): Promise<SyncProgress> {
    const total = memories.length;
    let synced = 0;
    let failed = 0;

    for (const memory of memories) {
        try {
            const resp = await fetch(`${settings.serverUrl}/api/kg/memories`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': settings.apiKey
                },
                body: JSON.stringify({
                    content: memory.content,
                    category: memory.category,
                    source: 'aimindmesh_android',
                    createdAt: memory.timestamp instanceof Date
                        ? memory.timestamp.toISOString()
                        : new Date(memory.timestamp).toISOString()
                }),
                signal: AbortSignal.timeout(10000)
            });
            if (resp.ok) { synced++; } else { failed++; }
        } catch (e) {
            failed++;
            logger.log('warn', `[MemorySync] Failed to sync memory ${memory.id}`, e);
        }
        // Yield to UI between each POST (ANR prevention)
        await new Promise(r => setTimeout(r, 0));
        onProgress?.({ total, synced, failed, done: false });
    }

    const result: SyncProgress = { total, synced, failed, done: true };
    onProgress?.(result);
    logger.log('info', `[MemorySync] Bulk sync complete: ${synced}/${total} synced, ${failed} failed`);
    return result;
}

/**
 * Fire-and-forget single memory sync.
 * Called after saving a new memory when autoSyncNewMemories=true.
 */
export function syncSingleMemoryToServer(
    memory: Memory,
    settings: AIMindMeshServerSettings
): void {
    if (!settings.enabled || !settings.serverUrl || !settings.apiKey) return;
    fetch(`${settings.serverUrl}/api/kg/memories`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': settings.apiKey
        },
        body: JSON.stringify({
            content: memory.content,
            category: memory.category,
            source: 'aimindmesh_android',
            createdAt: memory.timestamp instanceof Date
                ? memory.timestamp.toISOString()
                : new Date(memory.timestamp).toISOString()
        })
    }).catch(e => logger.log('warn', '[MemorySync] Auto-sync failed', e));
}
