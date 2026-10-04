import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@capacitor/core', () => ({ CapacitorHttp: { request: http.request } }));
vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('../src/services/model/embedding/embeddingRuntime', () => ({ getActiveEmbeddingModel: () => null, embedText: vi.fn() }));
// Plain settings (no Keystore in tests)
vi.mock('../src/services/security/secretStore', () => ({
    readSetting: (key: string, fallback: any) => {
        const raw = localStorage.getItem(key);
        return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
    },
}));

import { searchWeb, duckDuckGoRegion, clampResultCount } from '../src/services/web/webSearch';
import { clearPageCache, PART_CHARS } from '../src/services/web/pageReader';
import { executeSearchWeb, executeReadWebPage, executeAnalyzeWeb, webTools } from '../src/services/tools/webTools';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', 'web', name), 'utf8');
const html = (data: string, status = 200, headers: Record<string, string> = { 'Content-Type': 'text/html; charset=utf-8' }) =>
    ({ status, data, headers, url: '' });
const requestedUrls = () => http.request.mock.calls.map(call => call[0].url as string);

const enableServer = (flags: Record<string, boolean>) => localStorage.setItem('aimindmesh-server-settings', JSON.stringify({
    enabled: true, serverUrl: 'http://10.2.0.1:3030/', apiKey: 'node-key', ...flags,
}));

beforeEach(() => {
    http.request.mockReset();
    clearPageCache();
});

describe('search_web', () => {
    it('falls back from the DuckDuckGo bot check to the lite page, with region and time range', async () => {
        http.request
            .mockResolvedValueOnce(html(fixture('ddg-challenge.html'), 202))
            .mockResolvedValueOnce(html(fixture('ddg-lite.html')));

        const result = await searchWeb('prezzo benzina oggi', { timeRange: 'week', locale: 'it-IT', numResults: 2 });

        expect(result).toMatchObject({ success: true, provider: 'duckduckgo-lite' });
        expect(result.results).toHaveLength(2);
        expect(requestedUrls()[0]).toBe('https://html.duckduckgo.com/html/?q=prezzo%20benzina%20oggi&kl=it-it&df=w');
        expect(requestedUrls()[1]).toContain('https://lite.duckduckgo.com/lite/?q=prezzo%20benzina%20oggi&kl=it-it&df=w');
        expect(http.request.mock.calls[0][0]).toMatchObject({ connectTimeout: expect.any(Number), readTimeout: expect.any(Number) });
    });

    it('uses Brave when DuckDuckGo fails, and reports every failure when all engines fail', async () => {
        http.request
            .mockRejectedValueOnce(new Error('reset'))
            .mockResolvedValueOnce(html('<html>no results</html>'))
            .mockResolvedValueOnce(html(fixture('brave.html')));
        const ok = await searchWeb('benzina', { locale: 'it-IT' });
        expect(ok.provider).toBe('brave');
        expect(requestedUrls()[2]).toBe('https://search.brave.com/search?q=benzina&source=web');

        http.request.mockReset();
        http.request.mockResolvedValue(html('', 503));
        const failed = await searchWeb('benzina');
        expect(failed.success).toBe(false);
        expect(failed.error).toMatch(/duckduckgo: HTTP 503.*brave: HTTP 503/);
    });

    it('delegates to the server with the saved settings and falls back to the device on error', async () => {
        enableServer({ delegateWebSearch: true });
        http.request.mockResolvedValueOnce({
            status: 200, headers: {}, data: { success: true, results: [{ title: 'A', url: 'https://a.example/', snippet: 'x'.repeat(2000) }] },
        });
        const delegated = await searchWeb('meteo roma', { numResults: 3, timeRange: 'day', locale: 'it-IT' });
        expect(delegated.provider).toBe('server');
        expect(delegated.results[0].snippet.length).toBeLessThanOrEqual(320);
        expect(http.request.mock.calls[0][0]).toMatchObject({
            method: 'POST',
            url: 'http://10.2.0.1:3030/api/web/search',
            headers: { 'x-api-key': 'node-key' },
            data: { query: 'meteo roma', num_results: 3, time_range: 'day', lang: 'it-IT' },
        });

        http.request.mockReset();
        http.request.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(html(fixture('ddg-html.html')));
        const fallback = await searchWeb('meteo roma');
        expect(fallback.provider).toBe('duckduckgo');
    });

    it('gives the model the results, the sources and a hint to read pages', async () => {
        http.request.mockResolvedValueOnce(html(fixture('ddg-html.html')));
        const result = await executeSearchWeb({ query: 'prezzo benzina', num_results: 2 });
        expect(result.success).toBe(true);
        expect(result.message).toContain('[1] Prezzi medi dei carburanti – MIMIT\nURL: https://www.mimit.gov.it/it/prezzi');
        expect(result.message).toContain('read_web_page');
        expect(result.sources).toEqual([
            { title: 'Prezzi medi dei carburanti – MIMIT', uri: 'https://www.mimit.gov.it/it/prezzi' },
            { title: 'Page without snippet', uri: 'https://example.org/no-snippet' },
        ]);
    });

    it('maps locales to DuckDuckGo regions and clamps the result count', () => {
        expect(duckDuckGoRegion('it-IT')).toBe('it-it');
        expect(duckDuckGoRegion('en-GB')).toBe('uk-en');
        expect(duckDuckGoRegion('en')).toBe('wt-wt');
        expect(clampResultCount('3')).toBe(3);
        expect(clampResultCount(50)).toBe(6);
        expect(clampResultCount(-1)).toBe(5);
    });
});

describe('read_web_page', () => {
    const article = (paragraphs: number) => `<html><head><title>Guida</title><script>alert("x")</script></head><body>
        <nav>Menu</nav><article>${Array.from({ length: paragraphs }, (_, i) =>
            `<p>Paragrafo ${i}: ${i === 7 ? 'il biglietto del museo costa 12 euro.' : 'testo descrittivo della pagina. '.repeat(6)}</p>`).join('')}</article></body></html>`;

    it('returns readable text to the model, not HTML, one part at a time', async () => {
        http.request.mockResolvedValue(html(article(40)));
        const first = await executeReadWebPage({ url: 'https://example.com/guida' });
        expect(first.success).toBe(true);
        expect(first.message).toMatch(/^# Guida\nURL: https:\/\/example\.com\/guida\n\nParagrafo 0:/);
        expect(first.message).not.toMatch(/<|alert|Menu/);
        expect(first.message.length).toBeLessThan(PART_CHARS + 300);
        expect(first.message).toMatch(/\[Part 1 of \d+\. Next part: read_web_page\(\{"url":"https:\/\/example\.com\/guida","chunk_index":1\}\)\]$/);
        expect(first.sources).toEqual([{ title: 'Guida', uri: 'https://example.com/guida' }]);

        const second = await executeReadWebPage({ url: 'https://example.com/guida', chunk_index: '1' as any });
        expect(second.message).toMatch(/\[Part 2 of/);
        expect(second.message).not.toContain('Paragrafo 0:');
        expect(http.request).toHaveBeenCalledTimes(1); // the next part comes from the cache
    });

    it('returns only the passages relevant to a query', async () => {
        http.request.mockResolvedValue(html(article(40)));
        const result = await executeReadWebPage({ url: 'https://example.com/guida', query: 'prezzo biglietto museo' });
        expect(result.message).toContain('il biglietto del museo costa 12 euro');
        expect(result.message).toContain('Passages most relevant to "prezzo biglietto museo"');
        expect(result.message.length).toBeLessThan(2600);
    });

    it('is GET only and refuses local addresses and files', async () => {
        expect(webTools.find(t => t.name === 'read_web_page')!.parameters.properties).not.toHaveProperty('method');
        const local = await executeReadWebPage({ url: 'http://10.2.0.1:3030/api/config' });
        expect(local).toMatchObject({ success: false, message: expect.stringMatching(/private network/) });
        expect(http.request).not.toHaveBeenCalled();

        http.request.mockResolvedValueOnce(html('%PDF-1.7', 200, { 'content-type': 'application/pdf' }));
        const pdf = await executeReadWebPage({ url: 'https://example.com/doc.pdf' });
        expect(pdf).toMatchObject({ success: false, message: expect.stringMatching(/application\/pdf.*download_file/) });
        expect(http.request.mock.calls[0][0]).toMatchObject({ method: 'GET' });
    });

    it('follows redirects itself (http → https) and refuses redirects to the local network', async () => {
        http.request
            .mockResolvedValueOnce({ status: 301, headers: { Location: 'https://example.com/new' }, data: '', url: '' })
            .mockResolvedValueOnce(html('<title>New</title><body><p>Moved page</p></body>'));
        const moved = await executeReadWebPage({ url: 'http://example.com/old' });
        expect(moved.message).toBe('# New\nURL: https://example.com/new\n\nMoved page');

        http.request.mockReset();
        http.request.mockResolvedValueOnce({ status: 302, headers: { location: 'http://192.168.1.1/admin' }, data: '', url: '' });
        const blocked = await executeReadWebPage({ url: 'https://evil.example/' });
        expect(blocked).toMatchObject({ success: false, message: expect.stringMatching(/blocked address/) });
        expect(http.request).toHaveBeenCalledTimes(1);
    });

    it('reads through the server when delegated', async () => {
        enableServer({ delegateWebScraping: true });
        http.request.mockResolvedValueOnce({ status: 200, headers: {}, data: { success: true, title: 'T', url: 'https://example.com/final', data: 'Server text' } });
        const result = await executeReadWebPage({ url: 'https://example.com/start' });
        expect(result.message).toBe('# T\nURL: https://example.com/final\n\nServer text');
        expect(http.request.mock.calls[0][0]).toMatchObject({ url: 'http://10.2.0.1:3030/api/web/read', data: { url: 'https://example.com/start' } });
    });
});

describe('analyze_web', () => {
    it('is offered only when the server does the analysis, and returns the analysis text', async () => {
        const tool = webTools.find(t => t.name === 'analyze_web')!;
        expect(tool.isAvailable!()).toBe(false);
        expect((await executeAnalyzeWeb({ query: 'q' })).success).toBe(false);

        enableServer({ delegateWebAnalysis: true });
        expect(tool.isAvailable!()).toBe(true);
        http.request.mockResolvedValueOnce({ status: 200, headers: {}, data: { success: true, data: 'Synthesized answer [1]' } });
        expect(await executeAnalyzeWeb({ query: 'q' })).toMatchObject({ success: true, message: 'Synthesized answer [1]' });
    });
});
