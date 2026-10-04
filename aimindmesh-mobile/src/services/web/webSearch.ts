/**
 * Web Search Service
 *
 * Search without API keys: the AIMindMesh Server (SearXNG) when delegated, otherwise the
 * HTML pages of DuckDuckGo (html, then lite) and Brave, in this order until one answers
 * with results. Results are deduplicated and re-ranked against the query.
 */

import { CapacitorHttp } from '@capacitor/core';
import { logger } from '../logger';
import {
    SearchResult, MAX_SNIPPET_CHARS, parseDuckDuckGoHtml, parseDuckDuckGoLite, parseBraveHtml, isDuckDuckGoChallenge,
} from './searchParsers';
import { rerankSearchResults } from './ranking';
import { getWebDelegation, postToServer } from './webDelegation';

export type { SearchResult } from './searchParsers';

export type TimeRange = 'day' | 'week' | 'month' | 'year';
export const TIME_RANGES: TimeRange[] = ['day', 'week', 'month', 'year'];

export interface WebSearchOptions {
    numResults?: number;
    timeRange?: TimeRange;
    /** BCP 47 locale for the region of the results (default: the device's) */
    locale?: string;
}

export interface WebSearchResult {
    success: boolean;
    query: string;
    results: SearchResult[];
    provider?: string;
    error?: string;
}

export const DEFAULT_RESULTS = 5;
export const MAX_RESULTS = 6;
/** Results fetched before re-ranking keeps the best ones */
const CANDIDATES = 12;

export const BROWSER_USER_AGENT = 'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';

export function clampResultCount(value: unknown): number {
    const n = Math.round(Number(value));
    return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_RESULTS) : DEFAULT_RESULTS;
}

export function parseTimeRange(value: unknown): TimeRange | undefined {
    const v = String(value ?? '').toLowerCase().trim();
    return (TIME_RANGES as string[]).includes(v) ? v as TimeRange : undefined;
}

function deviceLocale(): string {
    return (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
}

/** DuckDuckGo region code ("it-it", "us-en", "uk-en"); "wt-wt" (no region) without a country. */
export function duckDuckGoRegion(locale: string): string {
    const [language, country] = locale.toLowerCase().split(/[-_]/);
    if (!language || !country || !/^[a-z]{2}$/.test(country)) return 'wt-wt';
    return `${country === 'gb' ? 'uk' : country}-${language}`;
}

/** Comparable form of a URL (no fragment, tracking parameters or trailing slash). */
function urlKey(raw: string): string {
    try {
        const url = new URL(raw);
        url.hash = '';
        [...url.searchParams.keys()].filter(k => /^(utm_|fbclid|gclid)/i.test(k)).forEach(k => url.searchParams.delete(k));
        return `${url.hostname.replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '')}${url.search}`.toLowerCase();
    } catch {
        return raw.toLowerCase();
    }
}

export function dedupeResults(results: SearchResult[]): SearchResult[] {
    const seen = new Set<string>();
    return results.filter(r => {
        const key = urlKey(r.url);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

interface SearchProvider {
    name: string;
    url: (query: string, options: Required<Pick<WebSearchOptions, 'locale'>> & WebSearchOptions) => string;
    parse: (html: string, maxResults: number) => SearchResult[];
}

const DDG_TIME: Record<TimeRange, string> = { day: 'd', week: 'w', month: 'm', year: 'y' };
const BRAVE_TIME: Record<TimeRange, string> = { day: 'pd', week: 'pw', month: 'pm', year: 'py' };

const ddgParams = (query: string, o: WebSearchOptions & { locale: string }) =>
    `q=${encodeURIComponent(query)}&kl=${duckDuckGoRegion(o.locale)}${o.timeRange ? `&df=${DDG_TIME[o.timeRange]}` : ''}`;

const PROVIDERS: SearchProvider[] = [
    { name: 'duckduckgo', url: (q, o) => `https://html.duckduckgo.com/html/?${ddgParams(q, o)}`, parse: parseDuckDuckGoHtml },
    { name: 'duckduckgo-lite', url: (q, o) => `https://lite.duckduckgo.com/lite/?${ddgParams(q, o)}`, parse: parseDuckDuckGoLite },
    {
        name: 'brave',
        url: (q, o) => `https://search.brave.com/search?q=${encodeURIComponent(q)}&source=web${o.timeRange ? `&tf=${BRAVE_TIME[o.timeRange]}` : ''}`,
        parse: parseBraveHtml,
    },
];

async function fetchSearchPage(url: string, locale: string): Promise<{ status: number; html: string }> {
    const response = await CapacitorHttp.request({
        method: 'GET',
        url,
        headers: {
            'User-Agent': BROWSER_USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': `${locale},${locale.split('-')[0]};q=0.9,en;q=0.5`,
        },
        connectTimeout: 8000,
        readTimeout: 10000,
    });
    const html = typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? '');
    return { status: response.status, html };
}

async function searchOnDevice(query: string, options: WebSearchOptions & { locale: string }): Promise<{ provider: string; results: SearchResult[] }> {
    const failures: string[] = [];
    for (const provider of PROVIDERS) {
        try {
            const { status, html } = await fetchSearchPage(provider.url(query, options), options.locale);
            if (status !== 200) throw new Error(`HTTP ${status}`);
            if (provider.name.startsWith('duckduckgo') && isDuckDuckGoChallenge(html)) throw new Error('bot check page');
            const results = dedupeResults(provider.parse(html, CANDIDATES));
            if (results.length > 0) return { provider: provider.name, results };
            throw new Error('no results parsed');
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            failures.push(`${provider.name}: ${reason}`);
            logger.log('warn', `[WebSearch] ${provider.name} failed (${reason}), trying the next engine`);
        }
    }
    throw new Error(`All search engines failed (${failures.join('; ')})`);
}

async function searchOnServer(query: string, options: WebSearchOptions & { locale: string }, numResults: number): Promise<SearchResult[] | null> {
    const delegation = getWebDelegation('search');
    if (!delegation) return null;
    try {
        const data = await postToServer<{ success?: boolean; results?: SearchResult[] }>(delegation, '/api/web/search', {
            query,
            num_results: numResults,
            time_range: options.timeRange,
            lang: options.locale,
        }, 20000);
        if (data?.success && Array.isArray(data.results) && data.results.length > 0) {
            return data.results.map(r => ({
                title: String(r.title || r.url),
                url: String(r.url),
                snippet: String(r.snippet || '').replace(/\s+/g, ' ').slice(0, MAX_SNIPPET_CHARS),
            }));
        }
        logger.log('warn', '[WebSearch] Server returned no results, searching on the device');
    } catch (error) {
        logger.log('warn', '[WebSearch] Server search failed, searching on the device', error);
    }
    return null;
}

/** Searches the web; never throws (failures come back with success=false). */
export async function searchWeb(query: string, options: WebSearchOptions = {}): Promise<WebSearchResult> {
    const trimmed = query.trim();
    if (!trimmed) return { success: false, query, results: [], error: 'Empty search query' };
    const numResults = clampResultCount(options.numResults);
    const opts = { ...options, locale: options.locale || deviceLocale() };

    try {
        const serverResults = await searchOnServer(trimmed, opts, numResults);
        if (serverResults) {
            return { success: true, query: trimmed, results: dedupeResults(serverResults).slice(0, numResults), provider: 'server' };
        }

        logger.log('info', `[WebSearch] "${trimmed}"`, { numResults, timeRange: opts.timeRange, locale: opts.locale });
        const { provider, results } = await searchOnDevice(trimmed, opts);
        const ranked = (await rerankSearchResults(trimmed, results)).slice(0, numResults);
        logger.log('info', `[WebSearch] ${provider}: ${results.length} results, kept ${ranked.length}`);
        return { success: true, query: trimmed, results: ranked, provider };
    } catch (error) {
        logger.log('error', '[WebSearch] Search failed', error);
        return { success: false, query: trimmed, results: [], error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

/** Search results as the model reads them. */
export function formatSearchResultsForContext(results: SearchResult[], query?: string): string {
    if (results.length === 0) return 'No web results found.';
    const list = results
        .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}${r.snippet ? `\n${r.snippet}` : ''}`)
        .join('\n\n');
    return `Web results${query ? ` for "${query}"` : ''}:\n\n${list}\n\n`
        + 'Answer from these snippets only if they clearly contain the answer; otherwise read the most relevant page with read_web_page. Cite the URLs you use.';
}
