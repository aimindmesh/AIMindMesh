import db from '../../db/sqlite';
import { Logger } from '../../utils/Logger';
import { InferenceRouter } from '../InferenceRouter';

/**
 * One pass of the insight merge cycle: groups the last 50 feed insights that share their source
 * concepts or that an LLM finds redundant, and folds each group into its first insight (debate
 * messages, human replies and source concepts move over, the others are deleted). Returns why
 * nothing was merged, or null after a merge.
 */
export async function mergeDuplicateInsights(opts: { batchable?: boolean } = {}): Promise<string | null> {
  const candidates = db.prepare(`
    SELECT id, content, source_node_ids as sourceNodeIds
    FROM feed_items
    WHERE type = 'INSIGHT'
    ORDER BY created_at DESC
    LIMIT 50
  `).all() as { id: string; content: string; sourceNodeIds: string }[];

  if (candidates.length < 2) {
    Logger.info('DebateEngine', 'Merge cycle: Insufficient candidates. Skipping.');
    return 'Insufficient candidates';
  }

  // 1. Deterministic grouping: same source concepts
  const deterministicGroups: string[][] = [];
  const visited = new Set<string>();

  for (let i = 0; i < candidates.length; i++) {
    if (visited.has(candidates[i].id)) continue;
    const group: string[] = [candidates[i].id];
    for (let j = i + 1; j < candidates.length; j++) {
      if (visited.has(candidates[j].id)) continue;
      if (
        candidates[i].sourceNodeIds === candidates[j].sourceNodeIds &&
        candidates[i].sourceNodeIds !== '[]'
      ) {
        group.push(candidates[j].id);
      }
    }
    if (group.length > 1) {
      group.forEach(id => visited.add(id));
      deterministicGroups.push(group);
    }
  }

  Logger.info('DebateEngine', 'Merge cycle: found ' + deterministicGroups.length + ' deterministic duplicate groups.');

  // 2. LLM grouping for remaining candidates (semantic similarity)
  const remainingCandidates = candidates.filter(c => !visited.has(c.id));
  let llmGroups: string[][] = [];

  if (remainingCandidates.length >= 2) {
    Logger.debug('DebateEngine', 'Asking LLM to analyze semantic overlap for ' + remainingCandidates.length + ' candidates...');
    const prompt =
      'Here is a list of AI insights from the knowledge feed. Identify if any are discussing the exact same concept or are redundant duplicates:\n' +
      remainingCandidates.map(c => '- ID: ' + c.id + ' | Content: ' + c.content).join('\n') +
      '\n\nReturn findings as JSON array of arrays of IDs: [["id1", "id2"]]. Empty array [] if none. NO thoughts, NO markdown.';

    try {
      const result = await InferenceRouter.routeTask({ 
        type: 'INSIGHT_DEDUP', 
        prompt, 
        tokensEstimate: 600,
        options: { taskName: 'Insight Merge Analysis', batchable: opts.batchable }
      });
      let rawJson = result.response.trim();
      if (rawJson.startsWith('```json')) rawJson = rawJson.substring(7);
      if (rawJson.endsWith('```')) rawJson = rawJson.substring(0, rawJson.length - 3).trim();
      llmGroups = JSON.parse(rawJson);
    } catch (e) {
      Logger.warn('DebateEngine', 'LLM merge analysis failed or returned invalid JSON.');
    }
  }

  const allGroups = [...deterministicGroups, ...llmGroups];

  if (allGroups.length === 0) {
    Logger.info('DebateEngine', 'Merge cycle completed: no duplicates found.');
    return 'No duplicates found';
  }

  Logger.info('DebateEngine', 'Merge cycle: consolidating ' + allGroups.length + ' groups total.');

  for (const group of allGroups) {
    if (!Array.isArray(group) || group.length < 2) continue;

    const validGroup = group.filter(id => candidates.some(c => c.id === id));
    if (validGroup.length < 2) continue;

    const primaryInsightId = validGroup[0];
    const obsoleteInsightIds = validGroup.slice(1);

    const primaryInsight = db.prepare(`SELECT * FROM feed_items WHERE id = ?`).get(primaryInsightId) as any;
    if (!primaryInsight) continue;

    const primaryThread = db.prepare(`SELECT id FROM debate_threads WHERE insight_id = ?`).get(primaryInsightId) as any;
    const primaryThreadId = primaryThread?.id;

    let consolidatedNodeIds: string[] = [];
    try { consolidatedNodeIds = JSON.parse(primaryInsight.source_node_ids || '[]'); } catch (e) { }

    // One transaction per group: a failure never leaves insights half merged
    db.transaction(() => {
      for (const obsInsightId of obsoleteInsightIds) {
        const obsInsight = db.prepare(`SELECT source_node_ids FROM feed_items WHERE id = ?`).get(obsInsightId) as any;
        if (obsInsight) {
          try {
            const obsNodeIds = JSON.parse(obsInsight.source_node_ids || '[]');
            obsNodeIds.forEach((id: string) => {
              if (!consolidatedNodeIds.includes(id)) consolidatedNodeIds.push(id);
            });
          } catch (e) { }
        }

        const obsThread = db.prepare(`SELECT id FROM debate_threads WHERE insight_id = ?`).get(obsInsightId) as any;
        if (obsThread && primaryThreadId) {
          // Migrate agent messages to primary thread and mark the obsolete one as merged
          db.prepare(`UPDATE debate_messages SET debate_id = ? WHERE debate_id = ?`).run(primaryThreadId, obsThread.id);
          db.prepare(`UPDATE debate_threads SET status = 'CLOSED', merged_into = ? WHERE id = ?`).run(primaryThreadId, obsThread.id);
        } else if (obsThread) {
          // No primary thread exists — just close the orphan thread
          db.prepare(`UPDATE debate_threads SET status = 'CLOSED' WHERE id = ?`).run(obsThread.id);
        }
        // Migrate human replies; queued deliveries of the obsolete insight are dropped (FK)
        db.prepare(`UPDATE feed_replies SET feed_item_id = ? WHERE feed_item_id = ?`).run(primaryInsightId, obsInsightId);
        db.prepare(`DELETE FROM pending_delivery WHERE insight_id = ?`).run(obsInsightId);
        db.prepare(`DELETE FROM feed_items WHERE id = ?`).run(obsInsightId);

        Logger.info('DebateEngine', 'Consolidated insight ' + obsInsightId + ' into ' + primaryInsightId);
      }

      // Update primary with consolidated node ids
      db.prepare(`UPDATE feed_items SET source_node_ids = ? WHERE id = ?`).run(JSON.stringify(consolidatedNodeIds), primaryInsightId);
    })();
  }

  return null;
}
