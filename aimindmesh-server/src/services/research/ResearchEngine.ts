import { randomUUID } from 'crypto';
import axios from 'axios';
import db from '../../db/sqlite';

export interface SearxngHit {
  title: string;
  url: string;
  content?: string;
  snippet?: string;
  score?: number;
  engine?: string;
}

export interface ResearchTopic {
  id: string;
  label: string;
  query: string;
  intervalMinutes: number;
  enabled: boolean;
  lastRunAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchRun {
  id: string;
  topicId?: string | null;
  mode: 'on-demand' | 'scheduled' | 'event-driven';
  triggerType: 'manual' | 'timer' | 'directive' | 'idea' | 'meeting' | 'role-proposal';
  query: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  startedAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchResult {
  id: string;
  runId: string;
  title: string;
  url: string;
  snippet: string;
  source: string;
  score?: number;
  raw: unknown;
}

export interface ResearchSummary {
  id: string;
  runId: string;
  summary: string;
  keyPoints: string[];
  risks: string[];
  opportunities: string[];
  recommendedFollowUps: string[];
  createdAt: string;
}

export class SearxngResearchService {
  constructor(private readonly baseUrl: string) {}

  async search(query: string, categories: string[] = ['general'], limit = 10): Promise<SearxngHit[]> {
    try {
      const params = new URLSearchParams();
      params.set('q', query);
      params.set('format', 'json');
      params.set('categories', categories.join(','));
      params.set('limit', String(limit));

      const url = `${this.baseUrl.replace(/\/$/, '')}/search?${params.toString()}`;
      const response = await axios.get(url, { timeout: 20000 });
      const data = response.data as any;
      return Array.isArray(data.results) ? data.results : [];
    } catch (e: any) {
      console.error('[Searxng] Search request failed:', e.message);
      return [];
    }
  }
}

export class ResearchQueryBuilder {
  buildFromTopic(topic: string): string[] {
    return [
      topic,
      `${topic} latest`,
      `${topic} alternatives`,
    ];
  }

  buildFromDirective(title: string, description: string): string[] {
    return [
      title,
      `${title} ${description}`,
      `${title} implementation examples`,
    ];
  }

  buildFromIdea(title: string): string[] {
    return [
      title,
      `${title} open source`,
      `${title} competitors`,
    ];
  }
}

export class ResearchResultNormalizer {
  normalize(runId: string, hits: SearxngHit[]): ResearchResult[] {
    return hits.map((hit, index) => ({
      id: `${runId}-${index}-${Math.random().toString(36).substr(2, 4)}`,
      runId,
      title: hit.title ?? 'Untitled',
      url: hit.url,
      snippet: hit.snippet ?? hit.content ?? '',
      source: hit.engine ?? 'searxng',
      score: hit.score,
      raw: hit,
    }));
  }

  deduplicate(results: ResearchResult[]): ResearchResult[] {
    const seen = new Set<string>();
    return results.filter(result => {
      const key = `${result.title.trim().toLowerCase()}|${result.url.trim().toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

export class SQLiteResearchRepository {
  async listTopics(): Promise<ResearchTopic[]> {
    const rows = db.prepare('SELECT * FROM organization_research_topics ORDER BY created_at DESC').all();
    return rows.map((r: any) => ({
      id: r.id,
      label: r.label,
      query: r.query,
      intervalMinutes: r.interval_minutes,
      enabled: !!r.enabled,
      lastRunAt: r.last_run_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async getTopic(id: string): Promise<ResearchTopic | null> {
    const r = db.prepare('SELECT * FROM organization_research_topics WHERE id = ?').get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      label: r.label,
      query: r.query,
      intervalMinutes: r.interval_minutes,
      enabled: !!r.enabled,
      lastRunAt: r.last_run_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async upsertTopic(topic: ResearchTopic): Promise<void> {
    db.prepare(`
      INSERT INTO organization_research_topics (id, label, query, interval_minutes, enabled, last_run_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        label = excluded.label,
        query = excluded.query,
        interval_minutes = excluded.interval_minutes,
        enabled = excluded.enabled,
        last_run_at = excluded.last_run_at,
        updated_at = excluded.updated_at
    `).run(
      topic.id,
      topic.label,
      topic.query,
      topic.intervalMinutes,
      topic.enabled ? 1 : 0,
      topic.lastRunAt || null,
      topic.createdAt,
      topic.updatedAt
    );
  }

  async createRun(run: ResearchRun): Promise<void> {
    db.prepare(`
      INSERT INTO organization_research_runs (id, topic_id, mode, trigger_type, query, status, started_at, completed_at, error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      run.id,
      run.topicId || null,
      run.mode,
      run.triggerType,
      run.query,
      run.status,
      run.startedAt || null,
      run.completedAt || null,
      run.error || null,
      run.createdAt,
      run.updatedAt
    );
  }

  async updateRun(id: string, patch: Partial<ResearchRun>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];

    const mapping: Record<string, string> = {
      status: 'status',
      startedAt: 'started_at',
      completedAt: 'completed_at',
      error: 'error',
      updatedAt: 'updated_at'
    };

    for (const [k, v] of Object.entries(patch)) {
      const dbCol = mapping[k];
      if (dbCol) {
        fields.push(`${dbCol} = ?`);
        values.push(v);
      }
    }

    if (fields.length === 0) return;
    values.push(id);
    db.prepare(`UPDATE organization_research_runs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  async insertResults(results: ResearchResult[]): Promise<void> {
    const stmt = db.prepare(`
      INSERT INTO organization_research_results (id, run_id, title, url, snippet, source, score, raw)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of results) {
      stmt.run(r.id, r.runId, r.title, r.url, r.snippet, r.source, r.score || null, JSON.stringify(r.raw));
    }
  }

  async insertSummary(summary: ResearchSummary): Promise<void> {
    db.prepare(`
      INSERT INTO organization_research_summaries (id, run_id, summary, key_points, risks, opportunities, recommended_follow_ups, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      summary.id,
      summary.runId,
      summary.summary,
      JSON.stringify(summary.keyPoints),
      JSON.stringify(summary.risks),
      JSON.stringify(summary.opportunities),
      JSON.stringify(summary.recommendedFollowUps),
      summary.createdAt
    );
  }

  async listRuns(limit = 100): Promise<ResearchRun[]> {
    const rows = db.prepare('SELECT * FROM organization_research_runs ORDER BY created_at DESC LIMIT ?').all(limit);
    return rows.map((r: any) => ({
      id: r.id,
      topicId: r.topic_id,
      mode: r.mode as any,
      triggerType: r.trigger_type as any,
      query: r.query,
      status: r.status as any,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      error: r.error,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async getRun(id: string): Promise<ResearchRun | null> {
    const r = db.prepare('SELECT * FROM organization_research_runs WHERE id = ?').get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      topicId: r.topic_id,
      mode: r.mode as any,
      triggerType: r.trigger_type as any,
      query: r.query,
      status: r.status as any,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      error: r.error,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}

export class ResearchPolicyService {
  allowOnDemand(): boolean {
    return true;
  }

  allowScheduled(): boolean {
    return true;
  }

  clampIntervalMinutes(input: number): number {
    return Math.max(30, Math.min(input, 7 * 24 * 60));
  }
}

export class ResearchScheduler {
  private jobs = new Map<string, NodeJS.Timeout>();

  schedule(id: string, intervalMinutes: number, enabled: boolean, task: () => Promise<void>): void {
    if (!enabled) return;
    this.cancel(id);
    const ms = intervalMinutes * 60 * 1000;
    const timer = setInterval(() => { void task(); }, ms);
    this.jobs.set(id, timer);
  }

  cancel(id: string): void {
    const timer = this.jobs.get(id);
    if (timer) {
      clearInterval(timer);
      this.jobs.delete(id);
    }
  }

  cancelAll(): void {
    for (const id of this.jobs.keys()) this.cancel(id);
  }
}

export class SearxngResearchEngine {
  constructor(
    private readonly searxng: SearxngResearchService,
    private readonly queries: ResearchQueryBuilder,
    private readonly normalizer: ResearchResultNormalizer,
    private readonly repo: SQLiteResearchRepository,
  ) {}

  async runOnDemand(query: string): Promise<ResearchRun> {
    return this.runInternal('on-demand', 'manual', query, null);
  }

  async runScheduled(topicId: string, topicQuery: string): Promise<ResearchRun> {
    const run = await this.runInternal('scheduled', 'timer', topicQuery, topicId);
    if (run.status === 'completed') {
      const now = new Date().toISOString();
      const topic = await this.repo.getTopic(topicId);
      if (topic) {
        topic.lastRunAt = now;
        topic.updatedAt = now;
        await this.repo.upsertTopic(topic);
      }
    }
    return run;
  }

  async runFromDirective(directiveId: string, query: string): Promise<ResearchRun> {
    return this.runInternal('event-driven', 'directive', query, directiveId);
  }

  private async runInternal(
    mode: ResearchRun['mode'],
    triggerType: ResearchRun['triggerType'],
    query: string,
    topicId: string | null,
  ): Promise<ResearchRun> {
    const now = new Date().toISOString();
    const run: ResearchRun = {
      id: randomUUID(),
      topicId,
      mode,
      triggerType,
      query,
      status: 'queued',
      startedAt: null,
      completedAt: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };

    await this.repo.createRun(run);
    await this.repo.updateRun(run.id, { status: 'running', startedAt: new Date().toISOString() });

    try {
      const queryVariants = this.queries.buildFromTopic(query);
      const allHits = [] as SearxngHit[];
      for (const q of queryVariants) {
        const hits = await this.searxng.search(q, ['general'], 10);
        allHits.push(...hits);
      }
      const results = this.normalizer.deduplicate(this.normalizer.normalize(run.id, allHits));
      await this.repo.insertResults(results);

      // Generate a synthetic summary for research runs
      const summaryText = `Web research scanning was completed successfully for query "${query}". Total unique reference hits cached: ${results.length}.`;
      const summary: ResearchSummary = {
        id: randomUUID(),
        runId: run.id,
        summary: summaryText,
        keyPoints: results.slice(0, 3).map(r => r.title),
        risks: ['External dependencies might change'],
        opportunities: ['Integrate recommended open-source components'],
        recommendedFollowUps: [`Refine strategic directives relating to: ${query}`],
        createdAt: new Date().toISOString()
      };
      await this.repo.insertSummary(summary);

      await this.repo.updateRun(run.id, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      return { ...run, status: 'completed', startedAt: run.startedAt, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    } catch (error: any) {
      await this.repo.updateRun(run.id, {
        status: 'failed',
        error: error?.message ?? 'research failed',
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return { ...run, status: 'failed', startedAt: run.startedAt, error: error?.message ?? 'research failed', completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    }
  }
}
