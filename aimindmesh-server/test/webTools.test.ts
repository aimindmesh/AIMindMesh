import dns from 'node:dns';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

// The real router opens the OpenClaw WebSocket at import time
vi.mock('../src/services/InferenceRouter', () => ({ InferenceRouter: { complete: vi.fn(), getEmbeddings: vi.fn() } }));

import { isPrivateAddress, assertPublicUrl, publicOnlyLookup, getPublicUrl } from '../src/utils/safeHttp';
import { WebScraperService, extractHtmlText } from '../src/services/WebScraperService';
import { SearchService } from '../src/services/SearchService';
import webRoutes from '../src/api/routes/web';

describe('safe outgoing HTTP', () => {
  it('recognizes private, loopback and reserved addresses', () => {
    for (const ip of ['127.0.0.1', '10.2.0.52', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.1.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '[::1]']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111', 'example.com']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('accepts only public http(s) URLs', () => {
    expect(assertPublicUrl('https://example.com/a').hostname).toBe('example.com');
    for (const url of ['http://localhost:3030', 'http://10.2.0.52:8080/search', 'http://[::1]/', 'file:///etc/passwd', 'gopher://x', 'nope']) {
      expect(() => assertPublicUrl(url), url).toThrow();
    }
  });

  it('refuses host names that resolve to a private address (DNS rebinding)', async () => {
    const lookup = vi.spyOn(dns, 'lookup') as any;
    lookup.mockImplementation((_host: string, _opts: any, cb: any) => cb(null, [{ address: '10.0.0.5', family: 4 }]));
    const err = await new Promise<any>(resolve => publicOnlyLookup('evil.example', {}, e => resolve(e)));
    expect(err?.code).toBe('EPRIVATE');

    lookup.mockImplementation((_host: string, _opts: any, cb: any) => cb(null, [{ address: '93.184.216.34', family: 4 }]));
    const ok = await new Promise<any[]>(resolve => publicOnlyLookup('example.com', {}, (_e, address, family) => resolve([address, family])));
    expect(ok).toEqual(['93.184.216.34', 4]);
    lookup.mockRestore();
  });

  it('never sends a request to a private URL', async () => {
    await expect(getPublicUrl('http://127.0.0.1:3030/api/config')).rejects.toThrow(/private/);
  });
});

describe('page text', () => {
  it('extracts the main content without scripts, menus and footers', () => {
    const filler = 'Il museo apre alle 9 e chiude alle 18 tutti i giorni tranne il lunedì. '.repeat(8);
    const { title, text } = extractHtmlText(`<html><head><title>Museo</title><script>var x = 1;</script></head><body>
      <nav>Menu Home</nav><main><h1>Orari</h1><p>${filler}</p><p>Biglietto: 12 euro</p></main><footer>Cookie</footer></body></html>`);
    expect(title).toBe('Museo');
    expect(text.split('\n')).toEqual(expect.arrayContaining(['Orari', 'Biglietto: 12 euro']));
    expect(text).not.toMatch(/var x|Menu Home|Cookie/);
  });

  it('returns the passages that share words with the query, in page order', () => {
    const text = Array.from({ length: 30 }, (_, i) => i === 20 ? 'Il biglietto del museo costa 12 euro' : `Riga ${i} di testo generico sulla storia della città`).join('\n');
    const passages = WebScraperService.relevantPassages(text, 'prezzo biglietto museo', 2, 200);
    expect(passages).toHaveLength(2);
    expect(passages.some(p => p.includes('12 euro'))).toBe(true);
  });
});

describe('web routes', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    app.register(webRoutes, { prefix: '/api/web' });
    await app.ready();
  });
  afterEach(() => vi.restoreAllMocks());

  it('/search runs a standard search with the requested range and bounded snippets', async () => {
    const search = vi.spyOn(SearchService, 'search').mockResolvedValue([
      { title: 'A', url: 'https://a.example', content: 'x'.repeat(5000) },
    ]);
    const res = await app.inject({ method: 'POST', url: '/api/web/search', payload: { query: 'meteo', num_results: 50, time_range: 'day', lang: 'it-IT' } });
    expect(res.statusCode).toBe(200);
    expect(search).toHaveBeenCalledWith('meteo', { numResults: 10, deep: false, lang: 'it-IT', timeRange: 'day' });
    expect(res.json().results[0].snippet).toHaveLength(500);
  });

  it('/read is GET only, refuses private URLs and returns the page text', async () => {
    const blocked = await app.inject({ method: 'POST', url: '/api/web/read', payload: { url: 'http://10.2.0.52:8080/' } });
    expect(blocked.statusCode).toBe(400);

    const fetchPage = vi.spyOn(WebScraperService, 'fetchPage').mockResolvedValue({ url: 'https://example.com/final', title: 'T', text: 'Page text' });
    const res = await app.inject({ method: 'POST', url: '/api/web/read', payload: { url: 'https://example.com/', method: 'POST', body: 'secret' } });
    expect(res.json()).toEqual({ success: true, url: 'https://example.com/final', title: 'T', data: 'Page text' });
    expect(fetchPage).toHaveBeenCalledWith('https://example.com/');
  });
});
