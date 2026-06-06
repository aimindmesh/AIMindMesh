import cron, { ScheduledTask } from 'node-cron';
import { config } from '../config';
import { KGManager } from './KGManager';
import { InferenceRouter } from './InferenceRouter';
import { sendToDevice } from './FCMDispatcher';
import { NodeRegistry } from './NodeRegistry';
import db from '../db/sqlite';
import crypto from 'crypto';
import { Logger } from '../utils/Logger';
import { runAgentTask } from './OpenClawBridge';
import { DeliveryScheduler } from './DeliveryScheduler';
import { NotificationService } from './NotificationService';
import { SearchService } from './SearchService';

// Dedicated session keys — never collide with OpenClaw internal sessions
const SESSION_ENRICHMENT = 'aimindmesh:enrichment';

export class ProactiveEngine {
  private static task: ScheduledTask | null = null;
  private static isRunning = false;

  public static start() {
    this.stop();
    if (!config.proactive.enabled) {
      Logger.debug('ProactiveEngine', 'Proactive Engine is disabled in config');
      return;
    }

    const cronExpr = `0 */${config.proactive.intervalHours} * * *`;

    this.task = cron.schedule(cronExpr, async () => {
      await this.runCycle();
    }, {
      timezone: config.proactive.timezone
    });
    Logger.info('ProactiveEngine', 'Proactive Engine started with schedule: ' + cronExpr);
  }

  public static stop() {
    if (this.task) this.task.stop();
  }


  public static async runCycle(): Promise<{ started: boolean; message?: string }> {
    if (this.isRunning) return { started: false, message: 'Cycle already in progress' };

    this.isRunning = true;
    const cycleId = crypto.randomUUID();
    let logMsg = '';

    try {
      Logger.info('ProactiveEngine', 'Starting proactive cycle...', { cycleId });

      const samplingLimit = Math.floor(Number(config.proactive.samplingLimit)) || 10;
      const samples = await KGManager.sampleUnexplored(samplingLimit);

      Logger.info('ProactiveEngine', `Sampled ${samples.length} unexplored concept pairs`, { cycleId });

      if (samples.length === 0) {
        logMsg = 'No unexplored samples found (Graph might be fully connected).';
        Logger.info('ProactiveEngine', logMsg, { cycleId });
        return { started: false, message: logMsg };
      }

      // Pick a random pair from the retrieved samples for extra variety
      const randomIndex = Math.floor(Math.random() * samples.length);
      const pair = samples[randomIndex];
      const contextStr =
        'Concept A: ' + pair.a.name + ' - ' + pair.a.description + '\n' +
        'Concept B: ' + pair.b.name + ' - ' + pair.b.description;

      // 2. SEARCH INTEGRATION for Proactive Insights
      let searchContext = "";
      if (config.search?.enabled) {
        try {
          const query = `${pair.a.name} ${pair.b.name}`;
          const results = await SearchService.search(query);
          if (results.length > 0) {
            searchContext = SearchService.formatResultsForContext(results);
          }
        } catch (e: any) {
          Logger.warn('ProactiveEngine', 'Search failed for concept pair: ' + e.message);
        }
      }

      const prompt =
        'System: You are a reflective thinking engine. Your goal is to find non-obvious connections, ' +
        'contradictions, or unexplored ideas between concepts. Be concise. Express one clear original thought. ' +
        'Never repeat obvious facts. CRITICAL: Always respond in English, regardless of the input language.\n\n' +
        'Context:\n' + contextStr + '\n\n' +
        (searchContext ? '── RESEARCH DATA ──\n' + searchContext + '\n\n' : '') +
        'Task: What is an interesting, non-obvious observation or connection you can make from this context? ' +
        (searchContext ? 'Incorporate relevant external data if applicable. ' : '') +
        'Express it as a single clear thought (2-4 sentences max). Respond ONLY in English.';

      const result = await InferenceRouter.routeTask({
        type: 'PROACTIVE_INSIGHT',
        prompt,
        tokensEstimate: 300,
        options: { taskName: `Proactive Insight: ${pair.a.name} & ${pair.b.name}` }
      });

      const insight = result.response;

      if (insight.split(' ').length > 20) {
        const insightId = await KGManager.createInsight(insight, [pair.a.id, pair.b.id]);

        db.prepare(
          'INSERT INTO feed_items (id, type, content, source_node_ids, created_at) VALUES (?, \'INSIGHT\', ?, ?, ?)'
        ).run(insightId, insight, JSON.stringify([pair.a.id, pair.b.id]), Date.now());

        NotificationService.broadcast('new_insight', { id: insightId, content: insight });

        const { DebateEngine } = require('./DebateEngine');
        DebateEngine.startDebate(insightId, insight).catch((e: any) => {
          Logger.warn('ProactiveEngine', 'DebateEngine.startDebate failed: ' + e.message);
        });

        // Neural Wiki: non-blocking refresh of source concept pages
        const { WikiSynthesisService } = require('./WikiSynthesisService');
        WikiSynthesisService.onNewInsight(insightId, insight, [pair.a.id, pair.b.id]);

        await DeliveryScheduler.deliver(
          insightId,
          '💡 New insight',
          insight.substring(0, 120),
          'INSIGHT'
        );
        Logger.info('ProactiveEngine', 'Insights handed over to DeliveryScheduler for ' + insightId);

        // Auto-Evolution: Set severity and potential target component
        try {
          const severity = this.calculateSeverity(insight);
          await this.setInsightMetadata(insightId, severity);
          Logger.info('ProactiveEngine', `Severity ${severity} assigned to insight ${insightId}`);
        } catch (e: any) {
          Logger.warn('ProactiveEngine', 'Failed to set insight severity: ' + e.message);
        }

        logMsg = 'Successfully created insight: ' + insightId;
      } else {
        logMsg = 'Generated insight too short or trivial, discarded.';
      }

    } catch (err: any) {
      logMsg = 'Error: ' + err.message;
      Logger.error('ProactiveEngine', 'Proactive Engine failed: ' + err.message, { cycleId });
    } finally {
      Logger.info('ProactiveEngine', 'Cycle completed: ' + logMsg, { cycleId });

      // ── Web Enrichment ─────────────────────────────────────────────
      if (config.proactive.enrichWithWeb && logMsg.startsWith('Successfully created insight')) {
        const insightId = logMsg.split(': ')[1];
        this.runEnrichment(insightId).catch(e => {
          Logger.warn('ProactiveEngine', 'Enrichment failed: ' + e.message);
        });
      }

      this.isRunning = false;
    }
    return { started: true };
  }

  public static calculateSeverity(insight: string): number {
    let score = 5; // baseline
    const lower = insight.toLowerCase();
    
    // Increase severity for critical keywords
    if (lower.includes('error') || lower.includes('bug') || lower.includes('fail')) score += 2;
    if (lower.includes('performance') || lower.includes('slow') || lower.includes('optimize')) score += 1;
    if (lower.includes('security') || lower.includes('auth') || lower.includes('leak')) score += 3;
    
    // Decrease for uncertain terms
    if (lower.includes('maybe') || lower.includes('perhaps') || lower.includes('consider')) score -= 1;
    
    return Math.max(0, Math.min(10, score));
  }

  private static async setInsightMetadata(id: string, severity: number) {
    const session = require('../db/neo4j').getSession();
    try {
      await session.run(`
        MATCH (i:Insight {id: $id})
        SET i.severity = $severity, 
            i.processed = false,
            i.source = 'ProactiveEngine',
            i.type = 'observation'
      `, { id, severity });
    } finally {
      await session.close();
    }
  }

  private static async runEnrichment(insightId: string) {
    // Use a dedicated session key — never 'system' or OpenClaw internal sessions
    const enrichPrompt =
      'skill: kg-enrichment\n' +
      'input: ' + JSON.stringify({ insightId });

    const result = await InferenceRouter.routeTask({
      type: 'AGENTIC_TASK',
      prompt: enrichPrompt,
      options: { 
        sessionKey: SESSION_ENRICHMENT,
        taskName: 'Knowledge Graph Enrichment'
      }
    });

    const reply = result.response;
    try {
      const enriched = JSON.parse(reply);
      for (const fact of enriched.facts ?? []) {
        await KGManager.upsertConcept(fact.conceptName, fact.content, []);
        await KGManager.linkConcepts(insightId, fact.conceptName, fact.relation, 0.8);
      }
      Logger.info('ProactiveEngine', 'KG enriched for insight ' + insightId, { factsAdded: enriched.facts?.length });
    } catch (e) {
      Logger.warn('ProactiveEngine', 'Failed to parse enrichment result for ' + insightId);
    }
  }
}