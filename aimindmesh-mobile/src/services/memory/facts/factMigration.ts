/**
 * One-time move of the old memories into facts, without deleting anything:
 * - the manual list ('companion-memories', always in the prompt until now) becomes pinned facts;
 * - facts extracted by older versions (rows of role 'extracted' in the episodic table)
 *   become facts with their vector. The rows stay (episodic retrieval ignores them).
 * Ids are deterministic and the marker is stored with the facts, so a run cut short is
 * simply repeated.
 */
import { logger } from '../../logger';
import { Fact, kindFromCategory, MAX_FACT_LENGTH } from './factTypes';
import { FactRepository } from './factRepository';

export const MIGRATION_KEY = 'facts-migration-v1';
const MANUAL_KEY = 'companion-memories';

interface LegacyMemory { id?: string; content?: string; category?: string; timestamp?: string | number }

function readManualMemories(): LegacyMemory[] {
    try {
        const parsed = JSON.parse(localStorage.getItem(MANUAL_KEY) || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function timeOf(value: unknown, fallback: number): number {
    const t = typeof value === 'number' ? value : new Date(value as string).getTime();
    return Number.isFinite(t) ? t : fallback;
}

export function manualMemoryToFact(memory: LegacyMemory, now: number): Fact | null {
    const content = (memory.content || '').replace(/\s+/g, ' ').trim().slice(0, MAX_FACT_LENGTH);
    if (!content) return null;
    const created = timeOf(memory.timestamp, now);
    return {
        id: `m:${memory.id || created}`,
        kind: kindFromCategory(memory.category),
        content,
        category: memory.category || undefined,
        importance: 4,
        confidence: 1,
        source: 'migrated',
        createdAt: created,
        updatedAt: created,
        status: 'active',
        pinned: true, // the manual list was always in the prompt: it stays there
        useCount: 0,
    };
}

export async function migrateLegacyMemories(repo: FactRepository, now: number = Date.now()): Promise<Fact[]> {
    if (await repo.getMeta(MIGRATION_KEY)) return [];

    const facts: Fact[] = readManualMemories()
        .map(m => manualMemoryToFact(m, now))
        .filter((f): f is Fact => f !== null);

    const extracted = repo.loadLegacyExtracted ? await repo.loadLegacyExtracted() : [];
    for (const row of extracted) {
        const content = row.content.replace(/\s+/g, ' ').trim().slice(0, MAX_FACT_LENGTH);
        if (!content) continue;
        facts.push({
            id: `x:${row.id}`, kind: 'other', content, importance: 3, confidence: 0.7, source: 'extracted',
            sourceThread: row.sessionId, createdAt: row.timestamp, updatedAt: row.timestamp,
            status: 'active', pinned: false, useCount: 0,
        });
    }

    if (facts.length > 0) {
        await repo.upsertMany(facts);
        if (repo.copyEmbedding) {
            for (const row of extracted) await repo.copyEmbedding(`x:${row.id}`, row.id);
        }
    }
    await repo.setMeta(MIGRATION_KEY, String(now));
    logger.log('info', `[FactMigration] ${facts.length} old memories moved to facts`);
    return facts;
}
