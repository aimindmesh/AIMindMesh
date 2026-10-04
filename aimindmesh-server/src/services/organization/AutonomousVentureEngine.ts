import * as cron from 'node-cron';
import { Logger } from '../../utils/Logger';
import { config } from '../../config';
import db from '../../db/sqlite';
import { VentureDiscoveryService } from './VentureDiscoveryService';
import { SQLiteDirectiveRepository } from './DirectiveService';
import { OrganizationAuditService } from './OrganizationAuditService';
import { notifyOwner } from './venture/notify';
import { saveDiscovered } from './venture/IdeaStore';

export interface DiscoveryConfig {
  enabled: boolean;
  cronExpression: string;
  maxTopicsPerCycle: number;
  minScoreThreshold: number;
  autoCouncil: boolean;
  minAutoCouncilScore: number;
  lastRunAt: string | null;
  updatedAt: string;
}

export interface DiscoveryStatus extends DiscoveryConfig {
  isRunning: boolean;
}

export class AutonomousVentureEngine {
  private static job: cron.ScheduledTask | null = null;
  private static isRunning = false;

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  public static start(): void {
    this.stop();
    this.ensureConfigRow();
    const cfg = this.getConfig();
    if (!cfg.enabled) {
      Logger.info('AutonomousVentureEngine', 'Disabled by configuration');
      return;
    }
    this.scheduleJob(cfg.cronExpression);
    Logger.info('AutonomousVentureEngine', `Started with schedule: ${cfg.cronExpression}`);
  }

  public static stop(): void {
    if (this.job) {
      this.job.stop();
      this.job = null;
    }
  }

  private static scheduleJob(cronExpression: string): void {
    this.stop();
    if (!cron.validate(cronExpression)) {
      Logger.error('AutonomousVentureEngine', `Invalid cron expression: ${cronExpression}`);
      return;
    }
    this.job = cron.schedule(cronExpression, async () => {
      await this.runCycle(false).catch(e =>
        Logger.error('AutonomousVentureEngine', `Cron cycle error: ${e.message}`)
      );
    });
    Logger.info('AutonomousVentureEngine', `Cron job scheduled: ${cronExpression}`);
  }

  // ─── Config ──────────────────────────────────────────────────────────────────

  private static ensureConfigRow(): void {
    const row = db.prepare('SELECT id FROM organization_discovery_config WHERE id = ?').get('singleton');
    if (!row) {
      // Off unless config.json explicitly opts in: discovery feeds the whole venture pipeline
      const orgCfg = config.organization?.autonomousDiscovery;
      db.prepare(`
        INSERT INTO organization_discovery_config
          (id, enabled, cron_expression, max_topics_per_cycle, min_score_threshold,
           auto_council, min_auto_council_score, last_run_at, updated_at)
        VALUES ('singleton', ?, ?, ?, ?, ?, ?, NULL, ?)
      `).run(
        orgCfg?.enabled === true ? 1 : 0,
        orgCfg?.cronExpression || '0 */12 * * *',
        orgCfg?.maxTopicsPerCycle || 3,
        orgCfg?.minScoreThreshold || 0.55,
        orgCfg?.autoCouncil ? 1 : 0,
        orgCfg?.minAutoCouncilScore || 0.75,
        new Date().toISOString()
      );
    }
  }

  public static getConfig(): DiscoveryConfig {
    this.ensureConfigRow();
    const row = db.prepare('SELECT * FROM organization_discovery_config WHERE id = ?').get('singleton') as any;
    return {
      enabled: row.enabled === 1,
      cronExpression: row.cron_expression,
      maxTopicsPerCycle: row.max_topics_per_cycle,
      minScoreThreshold: row.min_score_threshold,
      autoCouncil: row.auto_council === 1,
      minAutoCouncilScore: row.min_auto_council_score,
      lastRunAt: row.last_run_at,
      updatedAt: row.updated_at,
    };
  }

  public static updateConfig(patch: Partial<Omit<DiscoveryConfig, 'lastRunAt' | 'updatedAt'>>): DiscoveryConfig {
    this.ensureConfigRow();
    const now = new Date().toISOString();
    const fields: string[] = [];
    const values: any[] = [];

    if (patch.enabled !== undefined) { fields.push('enabled = ?'); values.push(patch.enabled ? 1 : 0); }
    if (patch.cronExpression !== undefined) { fields.push('cron_expression = ?'); values.push(patch.cronExpression); }
    if (patch.maxTopicsPerCycle !== undefined) { fields.push('max_topics_per_cycle = ?'); values.push(patch.maxTopicsPerCycle); }
    if (patch.minScoreThreshold !== undefined) { fields.push('min_score_threshold = ?'); values.push(patch.minScoreThreshold); }
    if (patch.autoCouncil !== undefined) { fields.push('auto_council = ?'); values.push(patch.autoCouncil ? 1 : 0); }
    if (patch.minAutoCouncilScore !== undefined) { fields.push('min_auto_council_score = ?'); values.push(patch.minAutoCouncilScore); }

    if (fields.length > 0) {
      fields.push('updated_at = ?');
      values.push(now);
      values.push('singleton');
      db.prepare(`UPDATE organization_discovery_config SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    const cfg = this.getConfig();

    // Reschedule if cron expression or enabled flag changed
    if (patch.cronExpression !== undefined || patch.enabled !== undefined) {
      if (cfg.enabled) {
        this.scheduleJob(cfg.cronExpression);
        Logger.info('AutonomousVentureEngine', `Rescheduled with new cron: ${cfg.cronExpression}`);
      } else {
        this.stop();
        Logger.info('AutonomousVentureEngine', 'Stopped (disabled via config update)');
      }
    }

    return cfg;
  }

  public static getStatus(): DiscoveryStatus {
    return { ...this.getConfig(), isRunning: this.isRunning };
  }

  // ─── Cycle ───────────────────────────────────────────────────────────────────

  public static async runCycle(manual = false): Promise<{ started: boolean; ideasFound: number; message?: string }> {
    if (this.isRunning) {
      return { started: false, ideasFound: 0, message: 'Cycle already in progress' };
    }

    const cfg = this.getConfig();
    if (!cfg.enabled && !manual) {
      return { started: false, ideasFound: 0, message: 'Engine is disabled' };
    }

    this.isRunning = true;
    let ideasFound = 0;

    try {
      Logger.info('AutonomousVentureEngine', `Starting ${manual ? 'manual' : 'scheduled'} discovery cycle`);

      // 1. Topics: organization-wide directives only (those derived from an idea guide its build, not discovery)
      const directiveRepo = new SQLiteDirectiveRepository();
      const directives = await directiveRepo.findActiveGlobal();
      let topics: string[] = directives.map(d => `${d.title}: ${d.description}`.substring(0, 200));

      // 2. Fallback: use recent insights if directives are insufficient
      if (topics.length < 2) {
        const feedRows = db.prepare(`
          SELECT content FROM feed_items
          WHERE type = 'INSIGHT'
          ORDER BY created_at DESC LIMIT 5
        `).all() as Array<{ content: string }>;
        const insightTopics = feedRows.map(r => r.content.substring(0, 150));
        topics = [...topics, ...insightTopics];
        Logger.info('AutonomousVentureEngine', `Supplemented with ${insightTopics.length} insight topics`);
      }

      // 3. Limit topics per cycle
      topics = topics.slice(0, cfg.maxTopicsPerCycle);
      if (topics.length === 0) {
        Logger.info('AutonomousVentureEngine', 'No topics available for discovery');
        return { started: true, ideasFound: 0, message: 'No topics available' };
      }

      Logger.info('AutonomousVentureEngine', `Processing ${topics.length} topics`);

      const discovery = new VentureDiscoveryService();
      const auditService = new OrganizationAuditService();

      for (const topic of topics) {
        try {
          // 4-6. Generate, drop duplicates and low scores, persist
          const { saved, skipped } = saveDiscovered(await discovery.discoverIdeas(topic), cfg.minScoreThreshold);
          for (const s of skipped) Logger.debug('AutonomousVentureEngine', `Skipped idea (${s.reason}): ${s.title}`);

          for (const idea of saved) {
            ideasFound++;
            await auditService.log({
              eventType: 'idea:autonomous-discover',
              actorType: 'system',
              actorId: 'autonomous-venture-engine',
              targetType: 'idea',
              targetId: idea.id,
              payload: { title: idea.title, overallScore: idea.overallScore, topic, sources: idea.sources.length }
            });
            Logger.info('AutonomousVentureEngine', `Saved new idea: "${idea.title}" (score: ${idea.overallScore.toFixed(2)})`);

            // 7. Auto Council if enabled and score is high enough
            if (cfg.autoCouncil && idea.overallScore >= cfg.minAutoCouncilScore) {
              this.triggerAutoCouncil(idea.id, idea.title).catch(e =>
                Logger.warn('AutonomousVentureEngine', `Auto council failed for ${idea.id}: ${e.message}`)
              );
            }
          }
        } catch (topicErr: any) {
          Logger.warn('AutonomousVentureEngine', `Topic processing failed for "${topic.substring(0, 60)}": ${topicErr.message}`);
        }
      }

      // 8. Update lastRunAt
      db.prepare(`UPDATE organization_discovery_config SET last_run_at = ?, updated_at = ? WHERE id = 'singleton'`)
        .run(new Date().toISOString(), new Date().toISOString());

      // 9. Notify if ideas were found
      if (ideasFound > 0) {
        await notifyOwner('new_ideas_discovered', { count: ideasFound }, {
          title: '💡 New venture ideas discovered',
          body: `${ideasFound} new project idea${ideasFound > 1 ? 's' : ''} found autonomously`,
        });
      }

      Logger.info('AutonomousVentureEngine', `Cycle completed — ${ideasFound} new ideas found`);
      return { started: true, ideasFound };

    } catch (err: any) {
      Logger.error('AutonomousVentureEngine', `Cycle error: ${err.message}`);
      return { started: true, ideasFound, message: `Error: ${err.message}` };
    } finally {
      this.isRunning = false;
    }
  }

  private static async triggerAutoCouncil(ideaId: string, ideaTitle: string): Promise<void> {
    Logger.info('AutonomousVentureEngine', `Triggering auto council for idea: ${ideaTitle}`);
    const { transitionIdea, runCouncilReview, approveForBuild } = await import('./venture/IdeaLifecycle');
    if (!transitionIdea(ideaId, ['proposed'], 'reviewing')) return;
    const consensus = await runCouncilReview(ideaId, 'proposed');

    // A build (repository + development agent) needs a human unless explicitly allowed
    const autoRepoAllowed = config.organization?.allowAutoRepoCreation === true;
    const auditService = new OrganizationAuditService();
    await auditService.log({
      eventType: 'idea:auto-council',
      actorType: 'system',
      actorId: 'autonomous-venture-engine',
      targetType: 'idea',
      targetId: ideaId,
      payload: { consensus, autoRepoAllowed }
    });
    if (!consensus) return;

    if (autoRepoAllowed) {
      await approveForBuild(ideaId, 'system', { wait: true });
      return;
    }
    await auditService.log({
      eventType: 'idea:auto-council-awaiting-human',
      actorType: 'system',
      actorId: 'autonomous-venture-engine',
      targetType: 'idea',
      targetId: ideaId,
      payload: { title: ideaTitle }
    });
    await notifyOwner('idea_awaiting_approval', { ideaId, title: ideaTitle }, {
      title: '🗳️ Idea approved by the AI council',
      body: `"${ideaTitle}" is waiting for your confirmation before a repository is created`,
    });
    Logger.info('AutonomousVentureEngine', `Idea "${ideaTitle}" approved by council, awaiting human confirmation`);
  }
}
