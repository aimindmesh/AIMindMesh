import db from '../db/sqlite';
import crypto from 'crypto';
import { Logger } from '../utils/Logger';
import { InferenceRouter } from './InferenceRouter';
import { sendToDevice } from './FCMDispatcher';
import { NodeRegistry } from './NodeRegistry';
import cron, { ScheduledTask } from 'node-cron';
import { config } from '../config';
import { SearchService } from './SearchService';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type MessageAuthor = string;

export interface DebateMessage {
  id: string;
  debateId: string;
  author: MessageAuthor;
  content: string;
  round: number;
  createdAt: number;
}

export interface DebateThread {
  id: string;
  insightId: string;
  insightContent: string;
  status: 'ACTIVE' | 'PAUSED' | 'CLOSED';
  currentRound: number;
  createdAt: number;
  updatedAt: number;
  mergedInto?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// DB Migration — call once at startup (e.g. in db/sqlite.ts or index.ts)
// ─────────────────────────────────────────────────────────────────────────────

export function migrateDebateTables(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS debate_threads (
      id              TEXT PRIMARY KEY,
      insight_id      TEXT NOT NULL,
      insight_content TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'ACTIVE',
      current_round   INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL,
      merged_into     TEXT
    );

    CREATE TABLE IF NOT EXISTS debate_messages (
      id         TEXT PRIMARY KEY,
      debate_id  TEXT NOT NULL,
      author     TEXT NOT NULL,
      content    TEXT NOT NULL,
      round      INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (debate_id) REFERENCES debate_threads(id)
    );

    CREATE INDEX IF NOT EXISTS idx_debate_insight  ON debate_threads(insight_id);
    CREATE INDEX IF NOT EXISTS idx_debate_messages ON debate_messages(debate_id, round);
  `);

  // Safe migration for existing DBs that don't have merged_into yet
  try { db.exec(`ALTER TABLE debate_threads ADD COLUMN merged_into TEXT`); } catch (_) { }

  Logger.info('DebateEngine', 'Debate tables migrated.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent Personas
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_PARTICIPANTS = [
  {
    name: 'ADVOCATE',
    persona: `You are ADVOCATE — a rigorous intellectual agent.
Your role: defend and expand the insight below. Find supporting evidence, analogies, and implications.
Be concise (3-5 sentences). Never repeat what was already said. Always push the idea further.
CRITICAL: Always respond in English, regardless of the input language.`
  },
  {
    name: 'CRITIC',
    persona: `You are CRITIC — a sharp analytical agent.
Your role: challenge the insight and the ADVOCATE's arguments. Find weaknesses, counterexamples, or alternative interpretations.
Be concise (3-5 sentences). Be constructive, not destructive. Open new angles.
CRITICAL: Always respond in English, regardless of the input language.`
  }
];

const ORCHESTRATOR_PERSONA = `You are ORCHESTRATOR — a synthesis agent.
Your role: read the full debate so far and produce a brief synthesis (3-5 sentences).
Identify the most interesting tension or open question that emerged. Do not take sides.
CRITICAL: Always respond in English, regardless of the input language.`;

// ─────────────────────────────────────────────────────────────────────────────
// Core Engine
// ─────────────────────────────────────────────────────────────────────────────

export class DebateEngine {

  private static task: ScheduledTask | null = null;
  private static isMerging = false;

  public static start(): void {
    this.stop();
    migrateDebateTables();

    if (!config.debate?.enabled) {
      Logger.debug('DebateEngine', 'Debate Engine is disabled in config');
      return;
    }

    if (config.debate?.mergeEnabled) {
      const interval = config.debate?.mergeIntervalHours || 12;
      const cronExpr = `0 */${interval} * * *`;
      this.task = cron.schedule(cronExpr, async () => {
        await this.runMergeCycle();
      });
      Logger.info('DebateEngine', 'Merge cycle registered: ' + cronExpr);
    }
  }

  public static stop(): void {
    if (this.task) this.task.stop();
  }

  /**
   * Forces a reprocessing of recent threads (active or closed).
   * Useful when new participants are added and their contribution on the past is desired.
   */
  public static async reprocessRecentThreads(limit: number = 20): Promise<void> {
    Logger.info('DebateEngine', `Starting on-demand sequential reprocessing of ${limit} recent threads...`);
    
    const threads = db.prepare(`
        SELECT id FROM debate_threads 
        ORDER BY updated_at DESC LIMIT ?
    `).all(limit) as { id: string }[];

    for (const t of threads) {
        // Reactivate the thread if necessary to allow round execution
        db.prepare(`UPDATE debate_threads SET status = 'ACTIVE' WHERE id = ?`).run(t.id);
        
        try {
          await this.runNextRound(t.id);
          Logger.info('DebateEngine', `Reprocessing completed for thread ${t.id}`);
        } catch (err: any) {
          Logger.error('DebateEngine', `Reprocessing failed for thread ${t.id}: ${err.message}`);
        }
        
        // Cooldown between threads to allow Ollama to breathe
        await new Promise(r => setTimeout(r, 2000));
    }
  }

  /**
   * Force reprocessing of a single insight.
   * Deletes previous messages and restarts the debate from scratch (Round 1).
   */
  public static async reprocessInsight(insightId: string): Promise<void> {
    const thread = this.getThreadByInsightId(insightId);
    if (!thread) {
      Logger.error('DebateEngine', `Cannot reprocess: insight ${insightId} has no debate thread.`);
      throw new Error('Insight not found in debate registry');
    }

    Logger.info('DebateEngine', `Forcing reprocess for insight ${insightId} (Thread: ${thread.id})`);

    // Reset thread state
    db.prepare(`DELETE FROM debate_messages WHERE debate_id = ?`).run(thread.id);
    db.prepare(`UPDATE debate_threads SET current_round = 0, status = 'ACTIVE' WHERE id = ?`).run(thread.id);

    // Trigger sequential round execution
    this.runNextRound(thread.id).catch(err => 
      Logger.error('DebateEngine', `Reprocess failed for ${thread.id}: ${err.message}`)
    );
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Starts a new debate for a given insight.
   * Called automatically by ProactiveEngine right after insight creation.
   */
  public static async startDebate(insightId: string, insightContent: string): Promise<string> {
    const debateId = crypto.randomUUID();
    const now = Date.now();

    db.prepare(`
      INSERT INTO debate_threads (id, insight_id, insight_content, status, current_round, created_at, updated_at)
      VALUES (?, ?, ?, 'ACTIVE', 0, ?, ?)
    `).run(debateId, insightId, insightContent, now, now);

    Logger.info('DebateEngine', 'Debate ' + debateId + ' started for insight ' + insightId);

    // Initial research and first round
    this.setupDebate(debateId, insightContent).catch(e => {
      Logger.error('DebateEngine', 'Debate setup failed for ' + debateId + ': ' + e.message);
    });

    return debateId;
  }

  private static async setupDebate(debateId: string, insightContent: string): Promise<void> {
    if (config.search?.enabled) {
      try {
        const results = await SearchService.search(insightContent);
        if (results.length > 0) {
          const research = SearchService.formatResultsForContext(results);
          this.persistMessage(debateId, 'SYSTEM_RESEARCH', research, 0);
        }
      } catch (err: any) {
        Logger.warn('DebateEngine', 'Pre-debate research failed: ' + err.message);
      }
    }
    await this.runNextRound(debateId);
  }

  /**
   * Manually updates the status of a debate thread.
   */
  public static async updateThreadStatus(insightId: string, status: 'ACTIVE' | 'CLOSED'): Promise<void> {
    const thread = this.getThreadByInsightId(insightId);
    if (!thread) throw new Error('Debate thread not found');

    db.prepare(`UPDATE debate_threads SET status = ?, updated_at = ? WHERE id = ?`)
      .run(status, Date.now(), thread.id);

    Logger.info('DebateEngine', 'Debate ' + thread.id + ' manual status update: ' + status);
  }

  /**
   * Called when the human replies to an insight.
   * Seeds a new debate round with the human's message as pivot.
   */
  public static async injectHumanMessage(
    insightId: string,
    humanText: string,
    onMessage?: (msg: DebateMessage) => void
  ): Promise<void> {
    const thread = this.getThreadByInsightId(insightId);
    if (!thread) {
      Logger.warn('DebateEngine', 'No debate thread found for insight ' + insightId + ' — ignoring human message');
      return;
    }

    this.persistMessage(thread.id, 'HUMAN', humanText, thread.currentRound + 1);

    db.prepare(`UPDATE debate_threads SET status = 'ACTIVE', updated_at = ? WHERE id = ?`)
      .run(Date.now(), thread.id);

    Logger.info('DebateEngine', 'Human injected into debate ' + thread.id + ' — launching new round');

    if (onMessage) {
      await this.runNextRound(thread.id, humanText, onMessage);
    } else {
      this.runNextRound(thread.id, humanText).catch(e => {
        Logger.error('DebateEngine', 'Round after human injection failed for ' + thread.id + ': ' + e.message);
      });
    }
  }

  /**
   * Returns the full debate thread messages ordered by round + time.
   * Filters out system/spurious messages (round >= 9000 or content starting with "System event:").
   */
  public static getDebateMessages(insightId: string): DebateMessage[] {
    const thread = this.getThreadByInsightId(insightId);
    if (!thread) return [];

    return db.prepare(`
      SELECT id, debate_id as debateId, author, content, round, created_at as createdAt
      FROM debate_messages
      WHERE debate_id = ?
        AND round < 9000
        AND content NOT LIKE 'System event:%'
      ORDER BY round ASC, created_at ASC
    `).all(thread.id) as DebateMessage[];
  }

  /**
   * Returns thread metadata (including merged_into) for a given insight.
   */
  public static getThreadByInsightId(insightId: string): DebateThread | null {
    const row = db.prepare(`
      SELECT id,
             insight_id      as insightId,
             insight_content as insightContent,
             status,
             current_round   as currentRound,
             created_at      as createdAt,
             updated_at      as updatedAt,
             merged_into     as mergedInto
      FROM debate_threads
      WHERE insight_id = ?
    `).get(insightId) as DebateThread | undefined;

    return row ?? null;
  }

  // ── Private: Round Execution ────────────────────────────────────────────────

  /**
   * Private: Executes the next round for a thread.
   * Now public to allow manual reprocessing.
   */
  public static async runNextRound(
    debateId: string,
    humanSeed?: string,
    onMessage?: (msg: DebateMessage) => void
  ): Promise<void> {
    const thread = this.getThreadById(debateId);
    if (!thread || thread.status !== 'ACTIVE') return;

    const nextRound = thread.currentRound + 1;
    let history = this.buildHistoryContext(debateId);

    Logger.info('DebateEngine', 'Running round ' + nextRound + ' for debate ' + debateId);

    const participants =
      config.debate?.participants && config.debate.participants.length > 0
        ? config.debate.participants
        : DEFAULT_PARTICIPANTS;

    let lastReply: string | null = null;

    // ── Dynamic Participants Loop ──────────────────────────────────────────
    for (const participant of participants) {
      const prompt = this.buildPrompt(participant.persona, thread.insightContent, history, humanSeed);
      const reply = await this.runInference(prompt, `Debate: ${participant.name} [Round ${nextRound}]`);
      const msg = this.persistMessage(debateId, participant.name, reply, nextRound);

      if (onMessage) onMessage(msg);

      history += '\n\n' + participant.name + ': ' + reply;
      lastReply = reply;
    }

    // ── ORCHESTRATOR synthesis (every 2 rounds) ──────────────────────────
    let orchestratorReply: string | null = null;
    if (nextRound % 2 === 0) {
      const orchestratorPrompt = this.buildPrompt(ORCHESTRATOR_PERSONA, thread.insightContent, history);
      orchestratorReply = await this.runInference(orchestratorPrompt, `Debate: ORCHESTRATOR [Round ${nextRound}]`);
      const msg = this.persistMessage(debateId, 'ORCHESTRATOR', orchestratorReply, nextRound);
      if (onMessage) onMessage(msg);
    }

    // ── Update thread ────────────────────────────────────────────────────
    db.prepare(`UPDATE debate_threads SET current_round = ?, updated_at = ? WHERE id = ?`)
      .run(nextRound, Date.now(), debateId);

    // ── Push notification ────────────────────────────────────────────────
    this.pushDebateUpdate(thread.insightId, nextRound, orchestratorReply ?? lastReply ?? '');

    // ── Auto-Evolution Conclusion Extraction ─────────────────────────────
    if (lastReply && (history.includes('Developer:') || lastReply.includes('implement') || lastReply.includes('add'))) {
        this.extractEvolutionConclusion(thread.insightId, history + '\n\nORCHESTRATOR: ' + orchestratorReply);
    }

    Logger.info('DebateEngine', 'Round ' + nextRound + ' completed for debate ' + debateId);
  }

  public static async extractEvolutionConclusion(insightId: string, fullHistory: string) {
    const session = require('../db/neo4j').getSession();
    try {
        // Extract the Developer's conclusion or the most actionable part of the debate
        const conclusionPrompt = `Extract the most actionable software improvement conclusion from this debate. 
        Focus on what should be implemented or changed in the code.
        If no clear implementation is proposed, respond with "NONE".
        CRITICAL: Always respond in English.
        
        DEBATE:
        ${fullHistory}
        
        CONCLUSION:`;
        
        const conclusion = await this.runInference(conclusionPrompt, 'Conclusion Extraction');
        if (conclusion !== 'NONE') {
            await session.run(`
                MATCH (i:Insight {id: $insightId})
                SET i.developerConclusion = $conclusion, 
                    i.processed = false,
                    i.source = 'DebateEngine',
                    i.type = 'open_question'
            `, { insightId, conclusion });
            Logger.info('DebateEngine', `Extracted evolution conclusion for insight ${insightId}`);
        }
    } catch (e: any) {
        Logger.warn('DebateEngine', 'Failed to extract evolution conclusion: ' + e.message);
    } finally {
      await session.close();
    }
  }

  // ── Private: Helpers ────────────────────────────────────────────────────────

  private static async runInference(prompt: string, taskName?: string): Promise<string> {
    const result = await InferenceRouter.routeTask({
      type: 'DEBATE_PARTICIPATION',
      prompt,
      tokensEstimate: Math.ceil(prompt.length / 4) + 300,
      options: { taskName }
    });
    return result.response.trim();
  }

  private static buildPrompt(
    persona: string,
    insightContent: string,
    history: string,
    humanSeed?: string
  ): string {
    let prompt = persona + '\n\n';
    prompt += '── ORIGINAL INSIGHT ──\n' + insightContent + '\n\n';

    if (history.trim().length > 0) {
      prompt += '── DEBATE SO FAR ──\n' + history + '\n\n';
    }

    if (humanSeed) {
      prompt +=
        '── HUMAN INTERVENTION ──\n' +
        'The human has just responded: "' + humanSeed + '"\n' +
        'Take this into account as the new direction for your argument.\n\n';
    }

    if (history.includes('SYSTEM_RESEARCH')) {
      prompt += '── RESEARCH DATA ──\n' +
        'You have access to web search results in the history. Use them to support your claims.\n' +
        'Cite them using [n] notation and add a brief "References" section if you use new information.\n\n';
    }

    prompt += '── YOUR TURN ──\n' +
              'CRITICAL: You MUST respond in English. This is a system-level constraint for multi-node interoperability. ' +
              'Even if the history or source insight is in another language, translate your perspective and provide your argument ONLY in English.\n';
    return prompt;
  }

  private static buildHistoryContext(debateId: string): string {
    const messages = db.prepare(`
      SELECT author, content
      FROM debate_messages
      WHERE debate_id = ?
        AND round < 9000
        AND content NOT LIKE 'System event:%'
      ORDER BY round ASC, created_at ASC
    `).all(debateId) as { author: string; content: string }[];

    return messages.map(m => m.author + ': ' + m.content).join('\n\n');
  }

  private static persistMessage(
    debateId: string,
    author: MessageAuthor,
    content: string,
    round: number
  ): DebateMessage {
    const msg: DebateMessage = {
      id: crypto.randomUUID(),
      debateId,
      author,
      content,
      round,
      createdAt: Date.now()
    };

    db.prepare(`
      INSERT INTO debate_messages (id, debate_id, author, content, round, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(msg.id, msg.debateId, msg.author, msg.content, msg.round, msg.createdAt);

    return msg;
  }

  private static getThreadById(debateId: string): DebateThread | null {
    const row = db.prepare(`
      SELECT id,
             insight_id      as insightId,
             insight_content as insightContent,
             status,
             current_round   as currentRound,
             created_at      as createdAt,
             updated_at      as updatedAt,
             merged_into     as mergedInto
      FROM debate_threads
      WHERE id = ?
    `).get(debateId) as DebateThread | undefined;

    return row ?? null;
  }

  private static pushDebateUpdate(insightId: string, round: number, latestMessage: string): void {
    const nodes = NodeRegistry.getNodes().filter(n => n.type === 'mobile' && n.fcm_token);
    for (const node of nodes) {
      if (node.fcm_token) {
        sendToDevice(node.fcm_token, {
          title: '🧠 Debate — Round ' + round,
          body: latestMessage.substring(0, 80) + '...',
          data: { insightId, type: 'DEBATE_UPDATE', round: String(round) }
        });
      }
    }
  }

  // ── Thread Merging ─────────────────────────────────────────────────

  public static async runMergeCycle(): Promise<{ started: boolean; message?: string }> {
    if (this.isMerging) return { started: false, message: 'Already running' };
    this.isMerging = true;

    Logger.info('DebateEngine', '🔍 Starting robust merge cycle for insights...');

    try {
      const candidates = db.prepare(`
        SELECT id, content, source_node_ids as sourceNodeIds
        FROM feed_items
        WHERE type = 'INSIGHT'
        ORDER BY created_at DESC
        LIMIT 50
      `).all() as { id: string; content: string; sourceNodeIds: string }[];

      if (candidates.length < 2) {
        Logger.info('DebateEngine', 'Merge cycle: Insufficient candidates. Skipping.');
        return { started: false, message: 'Insufficient candidates' };
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
            options: { taskName: 'Insight Merge Analysis' }
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
        return { started: false, message: 'No duplicates found' };
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
          if (obsThread) {
            if (primaryThreadId) {
              // Migrate agent messages to primary thread
              db.prepare(`UPDATE debate_messages SET debate_id = ? WHERE debate_id = ?`).run(primaryThreadId, obsThread.id);
              // Mark obsolete thread as merged
              db.prepare(`UPDATE debate_threads SET status = 'CLOSED', merged_into = ? WHERE id = ?`).run(primaryThreadId, obsThread.id);
            } else {
              // No primary thread exists — just close the orphan thread
              db.prepare(`UPDATE debate_threads SET status = 'CLOSED' WHERE id = ?`).run(obsThread.id);
            }
          }

          // Migrate human replies
          db.prepare(`UPDATE feed_replies SET feed_item_id = ? WHERE feed_item_id = ?`).run(primaryInsightId, obsInsightId);

          // Delete obsolete insight
          db.prepare(`DELETE FROM feed_items WHERE id = ?`).run(obsInsightId);

          Logger.info('DebateEngine', 'Consolidated insight ' + obsInsightId + ' into ' + primaryInsightId);
        }

        // Update primary with consolidated node ids
        db.prepare(`UPDATE feed_items SET source_node_ids = ? WHERE id = ?`).run(JSON.stringify(consolidatedNodeIds), primaryInsightId);
      }

      Logger.info('DebateEngine', '✅ Merge cycle complete.');

    } catch (err: any) {
      Logger.error('DebateEngine', 'Merge cycle failed: ' + err.message);
    } finally {
      this.isMerging = false;
    }
    return { started: true };
  }
}