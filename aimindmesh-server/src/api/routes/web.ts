/**
 * web.ts — REST routes for web search and scraping delegation
 * Prefix: /api/web
 *
 * Mirrors the mobile client's web tool capabilities:
 *  - POST /api/web/search  — DuckDuckGo/SearXNG search with RAG re-ranking
 *  - POST /api/web/read    — Fetch and clean a web page's text content
 *  - POST /api/web/analyze — Search + LLM synthesis via InferenceRouter
 */

import { FastifyInstance } from 'fastify';
import { SearchService } from '../../services/SearchService';
import { InferenceRouter } from '../../services/InferenceRouter';
import { Logger } from '../../utils/Logger';
import { config } from '../../config';
import https from 'https';
import http from 'http';
import { URL } from 'url';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Fetch a URL and return its raw text body.
 */
async function fetchPageText(
  targetUrl: string,
  method: string = 'GET',
  customHeaders?: Record<string, string>,
  body?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const transport = parsed.protocol === 'https:' ? https : http;

    const reqOptions: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: method.toUpperCase(),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AIMindMesh/1.0; +https://aimindmesh.app)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...customHeaders,
      },
    };

    const req = transport.request(reqOptions, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });

    req.setTimeout(20000, () => {
      req.destroy();
      reject(new Error('Page fetch timed out after 20s'));
    });

    req.on('error', reject);

    if (body) req.write(body);
    req.end();
  });
}

/**
 * Strip HTML tags and collapse whitespace for clean text extraction.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── Route plugin ──────────────────────────────────────────────────────────────

export default async function webRoutes(fastify: FastifyInstance) {

  // ── POST /api/web/search ─────────────────────────────────────────────────
  // Perform a web search via SearXNG and return structured results.
  // Falls back to DuckDuckGo HTML scraping if SearXNG is unavailable.
  fastify.post<{
    Body: { query: string; num_results?: number };
  }>('/search', async (req, reply) => {
    const { query, num_results = 5 } = req.body;
    if (!query?.trim()) {
      return reply.code(400).send({ success: false, error: 'query is required' });
    }

    try {
      Logger.info('WebRoutes', `[search] query="${query}" num_results=${num_results}`);

      const rawResults = await SearchService.search(query);
      const results = rawResults
        .slice(0, Math.min(num_results, 10))
        .map(r => ({
          title: r.title,
          url: r.url,
          snippet: r.content,
        }));

      return reply.send({ success: true, query, results });
    } catch (err: any) {
      Logger.error('WebRoutes', `[search] failed: ${err.message}`);
      return reply.code(500).send({ success: false, error: err.message });
    }
  });

  // ── POST /api/web/read ───────────────────────────────────────────────────
  // Fetch and clean a web page, returning its text content.
  // If `query` is provided, returns a relevant excerpt (simple keyword match).
  fastify.post<{
    Body: {
      url: string;
      query?: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    };
  }>('/read', async (req, reply) => {
    const { url, query, method = 'GET', headers: customHeaders, body } = req.body;

    if (!url?.startsWith('http')) {
      return reply.code(400).send({ success: false, error: 'url must start with http:// or https://' });
    }

    try {
      Logger.info('WebRoutes', `[read] url="${url}"`);
      const rawHtml = await fetchPageText(url, method, customHeaders, body);
      const text = stripHtml(rawHtml);

      // If a query is provided, do a simple excerpt extraction (keyword context)
      if (query) {
        const lowerText = text.toLowerCase();
        const lowerQuery = query.toLowerCase();
        const idx = lowerText.indexOf(lowerQuery.split(/\s+/)[0]);
        if (idx !== -1) {
          const start = Math.max(0, idx - 200);
          const end = Math.min(text.length, idx + 2000);
          const excerpt = text.slice(start, end);
          Logger.info('WebRoutes', `[read] Returning excerpt (${excerpt.length} chars) for query "${query}"`);
          return reply.send({ success: true, data: excerpt });
        }
      }

      // Return full text capped at 50 KB
      const truncated = text.slice(0, 50000);
      Logger.info('WebRoutes', `[read] Returning ${truncated.length} chars of page content`);
      return reply.send({ success: true, data: truncated });
    } catch (err: any) {
      Logger.error('WebRoutes', `[read] failed: ${err.message}`);
      return reply.code(500).send({ success: false, error: err.message });
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
