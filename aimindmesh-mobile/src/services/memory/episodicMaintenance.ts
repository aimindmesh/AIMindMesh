/**
 * Maintenance of the episodic memory (the `memories` table: what the user said, and summaries
 * of it). Never destructive for knowledge:
 * 1. near-identical rows of the SAME role are deduplicated (a fact is never dropped for a chat turn);
 * 2. chat turns older than EPISODE_SUMMARY_AGE_DAYS (already outside retrieval, pruned at 90
 *    days) are summarized per conversation and day, so what happened is kept.
 * Extracted facts and summaries are never merged, rewritten or deleted here.
 */
import { LLMConfig } from '../../types';
import { logger } from '../logger';
import { getMemoryDatabase, deduplicateExistingMemories, replaceMemoriesAtomically } from './memoryDatabase';
import { embedText, ensureEmbeddingModel, ensureEmbeddingModelFromSettings, getActiveEmbeddingModel } from '../model/embedding/embeddingRuntime';
import { runBackgroundTask } from '../llm/background/backgroundLlm';

export const EPISODE_SUMMARY_AGE_DAYS = 30;
/** Near-identical rows only: E5 models score unrelated sentences of one language 0.7-0.9 */
export const EPISODIC_DEDUP_THRESHOLD = 0.95;
export const SUMMARY_PREFIX = '[MEMORY SUMMARY]';
const MAX_GROUPS_PER_RUN = 3;
const MAX_ROWS_PER_GROUP = 40;

export interface TurnRow { id: string; sessionId: string; timestamp: number; content: string }
export interface TurnGroup { sessionId: string; day: string; rows: TurnRow[] }

const dayOf = (timestamp: number): string => {
    const d = new Date(timestamp);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Chat turns grouped by conversation and local day, oldest groups first. */
export function groupTurns(rows: TurnRow[], maxGroups: number = MAX_GROUPS_PER_RUN, maxRows: number = MAX_ROWS_PER_GROUP): TurnGroup[] {
    const groups = new Map<string, TurnGroup>();
    for (const row of [...rows].sort((a, b) => a.timestamp - b.timestamp)) {
        const day = dayOf(row.timestamp);
        const key = `${row.sessionId}\u0000${day}`;
        let group = groups.get(key);
        if (!group) {
            if (groups.size >= maxGroups) continue;
            group = { sessionId: row.sessionId, day, rows: [] };
            groups.set(key, group);
        }
        if (group.rows.length < maxRows) group.rows.push(row);
    }
    return [...groups.values()];
}

export const EPISODE_SYSTEM_PROMPT =
    'You write short diary notes about past conversations. Write in the same language as the messages, ' +
    'in the third person about the user ("the user"), with no preamble.';

export function buildEpisodePrompt(group: TurnGroup): string {
    const lines = group.rows.map(r => `- ${r.content.slice(0, 600)}`).join('\n');
    return `On ${group.day} the user wrote these messages in one conversation:\n${lines}\n\n` +
        'In 1-3 sentences, note what the user talked about, asked, decided, planned or felt. ' +
        'Keep names, dates and decisions. Do not invent anything.';
}

async function readOldTurns(olderThan: number): Promise<TurnRow[]> {
    const db = await getMemoryDatabase();
    const result = await db.query(
        `SELECT id, session_id, timestamp, content FROM memories
         WHERE role IN ('user', 'model') AND timestamp < ?
         ORDER BY timestamp ASC LIMIT ?`,
        [olderThan, MAX_GROUPS_PER_RUN * MAX_ROWS_PER_GROUP * 3]
    );
    return (result.values || []).map((r: any) => ({ id: r.id, sessionId: r.session_id, timestamp: r.timestamp, content: r.content }));
}

async function activeModelKey(llmConfig?: LLMConfig): Promise<string | null> {
    const loaded = llmConfig?.embeddingModelId
        ? await ensureEmbeddingModel(llmConfig.embeddingModelId)
        : await ensureEmbeddingModelFromSettings();
    return loaded ? getActiveEmbeddingModel()?.key ?? null : null;
}

export interface EpisodicMaintenanceResult {
    deduped: number;
    summarized: number;
    /** Why the summary step did not run or stopped (model busy, no embedding model...) */
    skipped?: string;
}

/**
 * Runs both steps. `requireIdleMs`: on-device quiet time for the LLM step (0 when the user
 * started it from the settings).
 */
export async function runEpisodicMaintenance(options: { llmConfig?: LLMConfig; requireIdleMs?: number } = {}): Promise<EpisodicMaintenanceResult> {
    const deduped = await deduplicateExistingMemories(EPISODIC_DEDUP_THRESHOLD);
    const result: EpisodicMaintenanceResult = { deduped, summarized: 0 };

    const cutoff = Date.now() - EPISODE_SUMMARY_AGE_DAYS * 24 * 60 * 60 * 1000;
    const groups = groupTurns(await readOldTurns(cutoff));
    if (groups.length === 0) return result;

    const modelKey = await activeModelKey(options.llmConfig);
    if (!modelKey) return { ...result, skipped: 'no_embedding_model' };

    for (const group of groups) {
        const generated = await runBackgroundTask({
            label: 'episode-summary',
            prompt: buildEpisodePrompt(group),
            systemPrompt: EPISODE_SYSTEM_PROMPT,
            llmConfig: options.llmConfig,
            requireIdleMs: options.requireIdleMs,
            maxTokens: 200,
        });
        if (!generated.text) return { ...result, skipped: generated.skipped };

        const content = `${SUMMARY_PREFIX} ${group.day}: ${generated.text}`;
        const { vector, key } = await embedText(content, 'passage');
        if (key !== modelKey) return { ...result, skipped: 'embedding_model_changed' };
        // Dated like the conversation it summarizes, in the same thread, in one transaction
        await replaceMemoriesAtomically({
            id: `summary_${group.sessionId}_${group.day}_${Math.random().toString(36).slice(2, 8)}`,
            sessionId: group.sessionId,
            role: 'system',
            content,
            embedding: vector,
            modelKey: key,
            timestamp: group.rows[group.rows.length - 1].timestamp,
        }, group.rows.map(r => r.id));
        result.summarized += group.rows.length;
        logger.log('info', `[EpisodicMaintenance] ${group.rows.length} turns of ${group.day} summarized`);
    }
    return result;
}
