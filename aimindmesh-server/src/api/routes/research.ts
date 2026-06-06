import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SQLiteResearchRepository, SearxngResearchService, ResearchQueryBuilder, ResearchResultNormalizer, SearxngResearchEngine } from '../../services/research/ResearchEngine';
import { config } from '../../config';
import db from '../../db/sqlite';

const repo = new SQLiteResearchRepository();
const searxngService = new SearxngResearchService(config.organization?.searxngBaseUrl || 'http://searxng:8080');
const queryBuilder = new ResearchQueryBuilder();
const normalizer = new ResearchResultNormalizer();
const engine = new SearxngResearchEngine(searxngService, queryBuilder, normalizer, repo);

export async function researchRoutes(app: FastifyInstance) {
  // Topics list
  app.get('/topics', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const topics = await repo.listTopics();
      return { success: true, topics };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  // Topic Create/Update
  app.post('/topics', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as any;
      const id = body.id || `topic-${Date.now()}`;
      const now = new Date().toISOString();

      const topic = {
        id,
        label: body.label || 'New Topic',
        query: body.query || '',
        intervalMinutes: Number(body.intervalMinutes) || 360,
        enabled: body.enabled !== false,
        lastRunAt: body.lastRunAt || null,
        createdAt: now,
        updatedAt: now
      };

      await repo.upsertTopic(topic);
      return { success: true, topic };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  // List all runs
  app.get('/runs', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const runs = await repo.listRuns();
      return { success: true, runs };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  // Trigger search run manually
  app.post('/run', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as any;
      if (!body.query) {
        return reply.status(400).send({ error: 'Query is required' });
      }
      const run = await engine.runOnDemand(body.query);
      return { success: true, run };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  // Run a specific topic
  app.post('/topics/:id/run', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const topic = await repo.getTopic(id);
      if (!topic) {
        return reply.status(404).send({ error: 'Topic not found' });
      }
      const run = await engine.runScheduled(topic.id, topic.query);
      return { success: true, run };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  // Get results for a run
  app.get('/runs/:runId/results', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { runId } = request.params as { runId: string };
      const results = db.prepare('SELECT * FROM organization_research_results WHERE run_id = ?').all(runId) as any[];
      const formatted = results.map(r => ({
        id: r.id,
        runId: r.run_id,
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        source: r.source,
        score: r.score,
        raw: JSON.parse(r.raw || '{}')
      }));
      return { success: true, results: formatted };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  // Get summary for a run
  app.get('/runs/:runId/summary', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { runId } = request.params as { runId: string };
      const summary = db.prepare('SELECT * FROM organization_research_summaries WHERE run_id = ?').get(runId) as any;
      if (!summary) return { success: false };
      return {
        success: true,
        summary: {
          id: summary.id,
          runId: summary.run_id,
          summary: summary.summary,
          keyPoints: JSON.parse(summary.key_points || '[]'),
          risks: JSON.parse(summary.risks || '[]'),
          opportunities: JSON.parse(summary.opportunities || '[]'),
          recommendedFollowUps: JSON.parse(summary.recommended_follow_ups || '[]'),
          createdAt: summary.created_at
        }
      };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });
}
