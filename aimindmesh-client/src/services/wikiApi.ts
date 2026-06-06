/**
 * wikiApi.ts
 * REST client for the Neural Wiki API.
 * Uses the same serverApi axios instance (auto-auth via interceptor).
 */

import { serverApi } from './serverApi';

export interface WikiPageSummary {
  slug: string;
  folder?: string;
  title: string;
  tags: string[];
  updatedAt: string;
  neo4jId?: string;
}

export interface WikiPage extends WikiPageSummary {
  body: string;
  sources?: { type: string; id: string }[];
}

export const wikiApi = {
  /** List all wiki pages */
  listPages: () =>
    serverApi.get<{ pages: WikiPageSummary[]; count: number }>('/api/wiki'),

  /** Get a single page by slug */
  getPage: (slug: string) =>
    serverApi.get<{ page: WikiPage }>(`/api/wiki/${encodeURIComponent(slug)}`),

  /** Simple title/tag search */
  search: (q: string) =>
    serverApi.get<{ results: WikiPageSummary[] }>(`/api/wiki/search?q=${encodeURIComponent(q)}`),

  /** Get raw index.md content */
  getIndex: () =>
    serverApi.get<string>('/api/wiki/index'),

  /** Get the last N log lines */
  getLog: (n = 50) =>
    serverApi.get<{ log: string }>(`/api/wiki/log?n=${n}`),

  /** Trigger a full synthesis cycle (non-blocking on server) */
  runCycle: () =>
    serverApi.post<{ started: boolean }>('/api/wiki/run-cycle'),

  /** Trigger regeneration of a single page */
  regeneratePage: (slug: string) =>
    serverApi.post<{ queued: boolean; slug: string }>(`/api/wiki/${encodeURIComponent(slug)}/regenerate`),

  /** Delete a page */
  deletePage: (slug: string) =>
    serverApi.delete<{ deleted: boolean }>(`/api/wiki/${encodeURIComponent(slug)}`),
};
