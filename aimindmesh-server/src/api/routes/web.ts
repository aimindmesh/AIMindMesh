/**
 * web.ts — REST routes for web search and scraping delegation
 * Prefix: /api/web
 *
 * Mirrors the mobile client's web tool capabilities:
 *  - POST /api/web/search  — SearXNG search (standard, not deep: the phone waits for it)
 *  - POST /api/web/read    — GET a public page and return its readable text
 *  - POST /api/web/analyze — Search + LLM synthesis via InferenceRouter
 */

import { FastifyInstance } from 'fastify';
import { SearchService, SearchOptions } from '../../services/SearchService';
import { WebScraperService } from '../../services/WebScraperService';
import { InferenceRouter } from '../../services/InferenceRouter';
import { Logger } from '../../utils/Logger';

const MAX_RESULTS = 10;
const MAX_SNIPPET_CHARS = 500;
/** Text returned by /read (the phone splits it into parts) */
const MAX_PAGE_CHARS = 200_000;
const TIME_RANGES = ['day', 'week', 'month', 'year'];

// ── Route plugin ──────────────────────────────────────────────────────────────

export default async function webRoutes(fastify: FastifyInstance) {

  // ── POST /api/web/search ─────────────────────────────────────────────────
  // Standard SearXNG search (no query expansion or page scraping: those take longer than
  // the phone's timeout). Snippets are bounded; the phone reads pages with /read.
  fastify.post<{
    Body: { query: string; num_results?: number; time_range?: string; lang?: string };
  }>('/search', async (req, reply) => {
    const { query, num_results, time_range, lang } = req.body || ({} as any);
    if (typeof query !== 'string' || !query.trim()) {
      return reply.code(400).send({ success: false, error: 'query is required' });
    }
    const count = Math.min(Math.max(Math.round(Number(num_results)) || 5, 1), MAX_RESULTS);
    const options: SearchOptions = {
      numResults: count,
      deep: false,
      ...(typeof lang === 'string' && /^[a-z]{2}(-[A-Za-z]{2})?$/.test(lang) ? { lang } : {}),
      ...(TIME_RANGES.includes(String(time_range)) ? { timeRange: time_range as SearchOptions['timeRange'] } : {}),
    };

    try {
      Logger.info('WebRoutes', `[search] query="${query}" num_results=${count} time_range=${options.timeRange ?? '-'}`);
      const results = (await SearchService.search(query.trim(), options))
        .slice(0, count)
        .map(r => ({
          title: r.title,
          url: r.url,
          snippet: (r.content || '').replace(/\s+/g, ' ').trim().slice(0, MAX_SNIPPET_CHARS),
        }));

      return reply.send({ success: true, query, results });
    } catch (err: any) {
      Logger.error('WebRoutes', `[search] failed: ${err.message}`);
      return reply.code(500).send({ success: false, error: err.message });
    }
  });

  // ── POST /api/web/read ───────────────────────────────────────────────────
  // GET a public page (no private addresses, redirects re-checked) and return its readable
  // text. With `query`, only the passages sharing most words with it.
  fastify.post<{
    Body: { url: string; query?: string };
  }>('/read', async (req, reply) => {
    const { url, query } = req.body || ({} as any);
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return reply.code(400).send({ success: false, error: 'url must start with http:// or https://' });
    }

    try {
      Logger.info('WebRoutes', `[read] url="${url}"`);
      const page = await WebScraperService.fetchPage(url);
      let text = page.text.slice(0, MAX_PAGE_CHARS);
      if (typeof query === 'string' && query.trim()) {
        text = WebScraperService.relevantPassages(text, query, 3).join('\n\n[…]\n\n');
      }
      Logger.info('WebRoutes', `[read] Returning ${text.length} chars of ${page.url}`);
      return reply.send({ success: true, url: page.url, title: page.title, data: text });
    } catch (err: any) {
      Logger.warn('WebRoutes', `[read] failed: ${err.message}`);
      const blocked = /private|not allowed|Only http/i.test(err.message);
      return reply.code(blocked ? 400 : 502).send({ success: false, error: err.message });
    }
  });

  // ── POST /api/web/analyze ────────────────────────────────────────────────
  // Search the web and synthesize results using the InferenceRouter.
  // More powerful than search alone: returns an LLM-composed answer with citations.
  fastify.post<{
    Body: { query: string; model?: string };
  }>('/analyze', async (req, reply) => {
    const { query, model } = req.body;
    if (!query?.trim()) {
      return reply.code(400).send({ success: false, error: 'query is required' });
    }

    try {
      Logger.info('WebRoutes', `[analyze] query="${query}"`);

      // 1. Fetch search results
      const results = await SearchService.search(query);
      if (results.length === 0) {
        return reply.send({
          success: false,
          error: 'No search results found for the given query.',
        });
      }

      // 2. Build context from results
      const context = SearchService.formatResultsForContext(results);

      // 3. Build synthesis prompt
      const prompt = `You are a research assistant. Based on the following web search results, provide a comprehensive, accurate answer to the query.

QUERY: ${query}

${context}

Provide a well-structured answer with citations to the source URLs where relevant. Be concise but complete.`;

      // 4. Route to InferenceRouter for LLM synthesis
      const response = await InferenceRouter.complete(prompt, 'WEB_RESEARCH', {
        model,
        taskName: `Web Analysis: ${query.slice(0, 50)}`,
      });

      Logger.info('WebRoutes', `[analyze] Synthesis complete (${response.length} chars)`);
      return reply.send({ success: true, query, data: response });
    } catch (err: any) {
      Logger.error('WebRoutes', `[analyze] failed: ${err.message}`);
      return reply.code(500).send({ success: false, error: err.message });
    }
  });
}
