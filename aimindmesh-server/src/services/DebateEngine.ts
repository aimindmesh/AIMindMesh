import db from '../db/sqlite';
import crypto from 'crypto';
import { Logger } from '../utils/Logger';
import { InferenceRouter } from './InferenceRouter';
import { sendToDevice } from './FCMDispatcher';
import { DeliveryScheduler } from './DeliveryScheduler';
import { NodeRegistry } from './NodeRegistry';
import cron, { ScheduledTask } from 'node-cron';
import { config } from '../config';
import { SearchService } from './SearchService';
import { mergeDuplicateInsights } from './debate/insightMerge';

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
// Debate tables are part of the schema baseline (db/migrations.ts)
// ─────────────────────────────────────────────────────────────────────────────


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

    if (!config.debate?.enabled) {
      Logger.debug('DebateEngine', 'Debate Engine is disabled in config');
      return;
    }

    if (config.debate?.mergeEnabled) {
      const interval = config.debate?.mergeIntervalHours || 12;
      const cronExpr = `0 */${interval} * * *`;
      // The scheduled merge can wait for Claude's half-price batches
      this.task = cron.schedule(cronExpr, async () => {
        await this.runMergeCycle({ batchable: true });
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
    // Insight + debate at the start of the round: identical for every call of the round, so it
    // is sent first and cached by Claude; the persona and this round's replies follow it
    const roundHistory = history;

    // ── Dynamic Participants Loop ──────────────────────────────────────────
    for (const participant of participants) {
      const { cachePrefix, prompt } = this.buildPrompt(participant.persona, thread.insightContent, roundHistory, history.slice(roundHistory.length), humanSeed);
      const reply = await this.runInference(prompt, `Debate: ${participant.name} [Round ${nextRound}]`, cachePrefix);
      const msg = this.persistMessage(debateId, participant.name, reply, nextRound);

      if (onMessage) onMessage(msg);

      history += '\n\n' + participant.name + ': ' + reply;
      lastReply = reply;
    }

    // ── ORCHESTRATOR synthesis (every 2 rounds) ──────────────────────────
    let orchestratorReply: string | null = null;
    if (nextRound % 2 === 0) {
      const orchestrator = this.buildPrompt(ORCHESTRATOR_PERSONA, thread.insightContent, roundHistory, history.slice(roundHistory.length));
      orchestratorReply = await this.runInference(orchestrator.prompt, `Debate: ORCHESTRATOR [Round ${nextRound}]`, orchestrator.cachePrefix);
      const msg = this.persistMessage(debateId, 'ORCHESTRATOR', orchestratorReply, nextRound);
      if (onMessage) onMessage(msg);
    }

    // ── Update thread ────────────────────────────────────────────────────
    db.prepare(`UPDATE debate_threads SET current_round = ?, updated_at = ? WHERE id = ?`)
      .run(nextRound, Date.now(), debateId);

    // ── Push notification ────────────────────────────────────────────────
    this.pushDebateUpdate(thread.insightId, nextRound, orchestratorReply ?? lastReply ?? '');

    // ── Auto-Evolution Conclusion Extraction ─────────────────────────────
    // Only a debate with a DEVELOPER voice can conclude on code, and only when insight-driven evolution is on
    // (the old trigger, any reply containing "add", fired on almost every round)
    const developerSpoke = participants.some(p => p.name.toUpperCase() === 'DEVELOPER');
    if (lastReply && developerSpoke && config.autoEvolution?.sources?.insights === true) {
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
        if (conclusion.trim() && !/^\W*none\b/i.test(conclusion.trim())) {
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

  private static async runInference(prompt: string, taskName?: string, cachePrefix?: string): Promise<string> {
    const result = await InferenceRouter.routeTask({
      type: 'DEBATE_PARTICIPATION',
      prompt,
      cachePrefix,
      tokensEstimate: Math.ceil((prompt.length + (cachePrefix?.length ?? 0)) / 4) + 300,
      options: { taskName }
    });
    return result.response.trim();
  }

  /**
   * Prompt of one debate turn, in two parts: the shared context (insight and the debate up to
   * the start of this round), then the persona, the replies of this round so far and the
   * instructions. Providers without prompt caching receive the two parts joined in this order.
   */
  private static buildPrompt(
    persona: string,
    insightContent: string,
    roundHistory: string,
    roundReplies: string,
    humanSeed?: string
  ): { cachePrefix: string; prompt: string } {
    let cachePrefix = '── ORIGINAL INSIGHT ──\n' + insightContent + '\n\n';
    if (roundHistory.trim().length > 0) {
      cachePrefix += '── DEBATE SO FAR ──\n' + roundHistory + '\n\n';
    }

    let prompt = persona + '\n\n';
    if (roundReplies.trim().length > 0) {
      prompt += '── THIS ROUND SO FAR ──\n' + roundReplies.trim() + '\n\n';
    }
    const history = roundHistory + roundReplies;

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
    return { cachePrefix, prompt };
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

  /** Not in quiet hours nor in contextual mode: a round never wakes the user (it is in the thread) */
  private static pushDebateUpdate(insightId: string, round: number, latestMessage: string): void {
    for (const node of NodeRegistry.getNodes().filter(n => n.type === 'mobile' && n.fcm_token)) {
      if (DeliveryScheduler.getModeForDevice(node.id) !== 'PUSH' || DeliveryScheduler.isQuietHour(node.id)) continue;
      sendToDevice(node.fcm_token!, {
        title: '🧠 Debate — Round ' + round,
        body: latestMessage.substring(0, 80) + '...',
        data: { insightId, type: 'DEBATE_UPDATE', round: String(round) }
      });
    }
  }

  // ── Thread Merging ─────────────────────────────────────────────────

  public static async runMergeCycle(opts: { batchable?: boolean } = {}): Promise<{ started: boolean; message?: string }> {
    if (this.isMerging) return { started: false, message: 'Already running' };
    this.isMerging = true;

    Logger.info('DebateEngine', '🔍 Starting robust merge cycle for insights...');

    try {
      const skipped = await mergeDuplicateInsights(opts);
      if (skipped) return { started: false, message: skipped };

      Logger.info('DebateEngine', '✅ Merge cycle complete.');

    } catch (err: any) {
      Logger.error('DebateEngine', 'Merge cycle failed: ' + err.message);
    } finally {
      this.isMerging = false;
    }
    return { started: true };
  }
}