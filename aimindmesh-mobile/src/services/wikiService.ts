/**
 * wikiService.ts
 * REST client for the Neural Wiki API on the AIMindMesh Server.
 * Follows the same pattern as feedService.ts.
 */

import { AIMindMeshServerSettings } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WikiPageSummary {
  slug: string;
  folder?: string;
  title: string;
  tags: string[];
  updatedAt: string;
  neo4jId?: string;
}

export interface WikiPage extends WikiPageSummary {
  body: string; // Raw Markdown content
  sources?: { type: string; id: string }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function headers(settings: AIMindMeshServerSettings) {
  return {
    'Content-Type': 'application/json',
    'x-api-key': settings.apiKey,
  };
}

function base(settings: AIMindMeshServerSettings) {
  return settings.serverUrl.replace(/\/$/, '');
}

// ─── API calls ────────────────────────────────────────────────────────────────

export async function fetchWikiIndex(
  settings: AIMindMeshServerSettings
): Promise<WikiPageSummary[]> {
  const resp = await fetch(`${base(settings)}/api/wiki`, {
    headers: headers(settings),
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`Wiki index fetch failed: ${resp.status}`);
  const data = await resp.json();
  return data.pages ?? [];
}

export async function fetchWikiPage(
  settings: AIMindMeshServerSettings,
  slug: string
): Promise<WikiPage> {
  const resp = await fetch(`${base(settings)}/api/wiki/${encodeURIComponent(slug)}`, {
    headers: headers(settings),
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`Wiki page fetch failed: ${resp.status}`);
  const data = await resp.json();
  return data.page as WikiPage;
}

export async function searchWiki(
  settings: AIMindMeshServerSettings,
  query: string
): Promise<WikiPageSummary[]> {
  const resp = await fetch(
    `${base(settings)}/api/wiki/search?q=${encodeURIComponent(query)}`,
    {
      headers: headers(settings),
      signal: AbortSignal.timeout(8000),
    }
  );
  if (!resp.ok) throw new Error(`Wiki search failed: ${resp.status}`);
  const data = await resp.json();
  return data.results ?? [];
}

export async function triggerWikiCycle(
  settings: AIMindMeshServerSettings
): Promise<void> {
  const resp = await fetch(`${base(settings)}/api/wiki/run-cycle`, {
    method: 'POST',
    headers: headers(settings),
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) throw new Error(`Wiki cycle trigger failed: ${resp.status}`);
}

export async function triggerWikiPageRegenerate(
  settings: AIMindMeshServerSettings,
  slug: string
): Promise<void> {
  const resp = await fetch(
    `${base(settings)}/api/wiki/${encodeURIComponent(slug)}/regenerate`,
    {
      method: 'POST',
      headers: headers(settings),
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(8000),
    }
  );
  if (!resp.ok) throw new Error(`Wiki regenerate failed: ${resp.status}`);
}
