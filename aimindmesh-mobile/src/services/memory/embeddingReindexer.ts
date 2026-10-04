/**
 * Background re-embedding of stored vectors that do not belong to the active embedding model
 * (another model, an older pipeline version, or rows saved before vectors were tagged).
 * Until a row is re-embedded, retrieval ignores it: vectors of different models are never
 * compared. Started by the embedding runtime whenever a model becomes active.
 */

import { SQLiteDBConnection, capSQLiteValues } from '@capacitor-community/sqlite';
import { logger } from '../logger';
import { embedText, getActiveEmbeddingModel } from '../model/embedding/embeddingRuntime';
import { getMemoryDatabase } from './memoryDatabase';
import { getKnowledgeDatabase } from '../database/knowledgeDatabase';
import { float32ToHex } from './embeddingCodec';

const PAGE_SIZE = 25;
/** Let app startup and the first reply go first */
const START_DELAY_MS = 5000;
/** Leave CPU to the chat (local LLMs share the cores) */
const ITEM_DELAY_MS = 30;

let running = false;
let rerunRequested = false;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function scheduleEmbeddingReindex(): void {
    if (running) {
        rerunRequested = true;
        return;
    }
    running = true;
    void (async () => {
        try {
            do {
                rerunRequested = false;
                await sleep(START_DELAY_MS);
                await reindexAll();
            } while (rerunRequested);
        } catch (error) {
            logger.log('warn', '[Reindex] Stopped', error);
        } finally {
            running = false;
        }
    })();
}

async function reindexAll(): Promise<void> {
    const model = getActiveEmbeddingModel();
    if (!model) return;
    const memories = await reindexTable('memories', getMemoryDatabase, model.key);
    // Facts get their first vector here too (new and edited ones have none)
    const facts = await reindexTable('memory_facts', getMemoryDatabase, model.key).catch(() => 0);
    const chunks = await reindexTable('document_chunks', getKnowledgeDatabase, model.key);
    if (memories + facts + chunks > 0) {
        logger.log('info', `[Reindex] Embedded ${memories} memories, ${facts} facts and ${chunks} document chunks with ${model.key}`);
    }
}

/**
 * Re-embeds rows whose embedding_model differs from `key`, in id order (each row is visited
 * once per run, so a text that fails to embed cannot loop). Stops when the model changes:
 * the new model schedules its own run.
 */
export async function reindexTable(
    table: 'memories' | 'memory_facts' | 'document_chunks',
    getDb: () => Promise<SQLiteDBConnection>,
    key: string
): Promise<number> {
    const db = await getDb();
    let cursor: string | number | null = null;
    let updated = 0;

    for (;;) {
        if (getActiveEmbeddingModel()?.key !== key) return updated;
        const result: capSQLiteValues = cursor === null
            ? await db.query(`SELECT id, content FROM ${table} WHERE embedding_model IS NOT ? ORDER BY id LIMIT ?`, [key, PAGE_SIZE])
            : await db.query(`SELECT id, content FROM ${table} WHERE embedding_model IS NOT ? AND id > ? ORDER BY id LIMIT ?`, [key, cursor, PAGE_SIZE]);
        const rows: any[] = result.values || [];
        if (rows.length === 0) return updated;
        cursor = rows[rows.length - 1].id;

        const set: Array<{ statement: string; values: any[] }> = [];
        for (const row of rows) {
            const content = typeof row.content === 'string' ? row.content : '';
            if (!content.trim()) continue;
            try {
                const { vector, key: usedKey } = await embedText(content, 'passage');
                if (usedKey !== key) return updated;
                set.push({
                    statement: `UPDATE ${table} SET embedding = X'${float32ToHex(vector)}', embedding_model = ? WHERE id = ?`,
                    values: [key, row.id],
                });
            } catch (error) {
                if (getActiveEmbeddingModel()?.key !== key) return updated;
                logger.log('debug', `[Reindex] Skipped ${table} row ${row.id}`, error);
            }
            await sleep(ITEM_DELAY_MS);
        }
        if (set.length > 0) {
            await db.executeSet(set, true);
            updated += set.length;
        }
    }
}
