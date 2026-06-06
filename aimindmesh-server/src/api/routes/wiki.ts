/**
 * wiki.ts — REST routes for the Neural Wiki
 * Prefix: /api/wiki
 */

import { FastifyInstance } from 'fastify';
import { WikiManager } from '../../services/WikiManager';
import { WikiSynthesisService } from '../../services/WikiSynthesisService';
import { Logger } from '../../utils/Logger';

export default async function wikiRoutes(fastify: FastifyInstance) {
  // ── GET /api/wiki ─────────────────────────────────────────────────────────
  // List all wiki pages (index catalog)
  fastify.get('/', async (_req, reply) => {
    try {
      const pages = await WikiManager.listPages();
      return reply.send({ pages, count: pages.length });
    } catch (e: any) {
      Logger.error('WikiRoutes', `listPages failed: ${e.message}`);
      return reply.code(500).send({ error: 'Failed to list wiki pages' });
    }
  });

  // ── GET /api/wiki/index ───────────────────────────────────────────────────
  // Raw index.md content
  fastify.get('/index', async (_req, reply) => {
    try {
      const content = await WikiManager.readIndex();
      return reply.header('Content-Type', 'text/markdown').send(content);
    } catch (e: any) {
      return reply.code(500).send({ error: 'Failed to read index' });
    }
  });

  // ── GET /api/wiki/log ─────────────────────────────────────────────────────
  // Last N lines of log.md
  fastify.get<{ Querystring: { n?: string } }>('/log', async (req, reply) => {
    try {
      const n = parseInt(req.query.n ?? '50', 10);
      const content = await WikiManager.readLog(n);
      return reply.send({ log: content });
    } catch (e: any) {
      return reply.code(500).send({ error: 'Failed to read log' });
    }
  });

  // ── GET /api/wiki/search ──────────────────────────────────────────────────
  // Simple full-text search over page titles and tags
  fastify.get<{ Querystring: { q?: string } }>('/search', async (req, reply) => {
    const q = (req.query.q ?? '').toLowerCase().trim();
    if (!q) return reply.send({ results: [] });
    try {
      const pages = await WikiManager.listPages();
      const results = pages.filter(p =>
        p.title.toLowerCase().includes(q) ||
        p.slug.includes(q) ||
        p.tags.some(t => t.toLowerCase().includes(q))
      );
      return reply.send({ results });
    } catch (e: any) {
      return reply.code(500).send({ error: 'Search failed' });
    }
  });

  // ── GET /api/wiki/:slug ───────────────────────────────────────────────────
  // Get full page content by slug
  fastify.get<{ Params: { slug: string } }>('/:slug', async (req, reply) => {
    try {
      const page = await WikiManager.loadPage(req.params.slug);
      if (!page) return reply.code(404).send({ error: 'Page not found' });
      return reply.send({ page });
    } catch (e: any) {
      Logger.error('WikiRoutes', `loadPage failed: ${e.message}`);
      return reply.code(500).send({ error: 'Failed to load page' });
    }
  });

  // ── POST /api/wiki/run-cycle ──────────────────────────────────────────────
  // Manually trigger a full synthesis cycle
  fastify.post('/run-cycle', async (_req, reply) => {
    try {
      Logger.info('WikiRoutes', 'Manual wiki synthesis cycle triggered via API');
      // Non-blocking: return immediately, cycle runs in background
      WikiSynthesisService.runCycle().catch(e =>
        Logger.error('WikiRoutes', `Manual cycle error: ${e.message}`)
      );
      return reply.send({ started: true });
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });

  // ── POST /api/wiki/:slug/regenerate ──────────────────────────────────────
  // Manually regenerate a single page (triggers onNewInsight pattern)
  fastify.post<{ Params: { slug: string } }>('/:slug/regenerate', async (req, reply) => {
    try {
      const page = await WikiManager.loadPage(req.params.slug);
      if (!page) return reply.code(404).send({ error: 'Page not found' });
      if (!page.neo4jId) return reply.code(422).send({ error: 'Page has no linked Neo4j node' });
      // Trigger non-blocking refresh
      WikiSynthesisService.onNewInsight('manual', '', [page.neo4jId]);
      return reply.send({ queued: true, slug: page.slug });
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });

  // ── DELETE /api/wiki/:slug ────────────────────────────────────────────────
  fastify.delete<{ Params: { slug: string } }>('/:slug', async (req, reply) => {
    try {
      await WikiManager.deletePage(req.params.slug);
      await WikiManager.rebuildIndex();
      return reply.send({ deleted: true });
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });
}
