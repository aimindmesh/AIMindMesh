/**
 * Web page reader for the read_web_page tool: fetches a public page (through the AIMindMesh
 * Server when delegated), extracts its readable text and returns a bounded slice of it, either
 * the passages most relevant to a query or one part of the page at a time (chunk_index).
 *
 * GET only, public addresses only: a page read by the model can contain instructions
 * (prompt injection), so the tool must not be able to send data or reach the local network.
 */

import { CapacitorHttp, type HttpResponse } from '@capacitor/core';
import { logger } from '../logger';
import { extractPageText } from './pageExtractor';
import { checkPublicHttpUrl } from './urlSafety';
import { selectRelevantPassages } from './ranking';
import { getWebDelegation, postToServer } from './webDelegation';
import { BROWSER_USER_AGENT } from './webSearch';

export interface ReadPageArgs {
    url: string;
    query?: string;
    chunk_index?: number | string;
}

export interface FetchedPage {
    url: string;
    title: string;
    text: string;
}

export interface ReadPageResult {
    success: boolean;
    message: string;
    page?: { url: string; title: string; part?: number; parts?: number };
}

/** One part of a page (~600-700 tokens): the agent loop summarizes tool outputs above ~800 */
export const PART_CHARS = 2200;
const PASSAGE_CHARS = 650;
const PASSAGES_PER_QUERY = 3;
/** Text kept per page: bounds memory and the number of parts */
const MAX_PAGE_CHARS = 200_000;

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_SIZE = 8;
const cache = new Map<string, { page: FetchedPage; at: number }>();

function cachedPage(url: string): FetchedPage | null {
    const entry = cache.get(url);
    if (!entry || Date.now() - entry.at > CACHE_TTL_MS) return null;
    return entry.page;
}

function cachePage(url: string, page: FetchedPage): void {
    cache.delete(url);
    cache.set(url, { page, at: Date.now() });
    while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
}

/** Test hook */
export function clearPageCache(): void {
    cache.clear();
}

/** Paragraphs, or the lines and sentences of a paragraph too long, with the separator before each. */
function textUnits(text: string, maxChars: number): Array<{ text: string; sep: string }> {
    const units: Array<{ text: string; sep: string }> = [];
    for (const paragraph of text.split(/\n{2,}/)) {
        if (paragraph.length <= maxChars) {
            units.push({ text: paragraph, sep: '\n\n' });
            continue;
        }
        paragraph.split('\n').forEach((line, lineIndex) => {
            const lineSep = lineIndex === 0 ? '\n\n' : '\n';
            if (line.length <= maxChars) {
                units.push({ text: line, sep: lineSep });
                return;
            }
            line.split(/(?<=[.!?])\s+/).forEach((sentence, i) => units.push({ text: sentence, sep: i === 0 ? lineSep : ' ' }));
        });
    }
    return units;
}

/**
 * Text split into pieces of at most `maxChars`, at paragraph, then line, sentence and word
 * boundaries. Nothing is dropped.
 */
export function splitText(text: string, maxChars: number): string[] {
    const pieces: string[] = [];
    let current = '';
    for (const unit of textUnits(text, maxChars)) {
        if (current && current.length + unit.sep.length + unit.text.length > maxChars) {
            if (current.trim()) pieces.push(current.trim());
            current = '';
        }
        current = current ? current + unit.sep + unit.text : unit.text;
        while (current.length > maxChars) {
            // A sentence longer than a piece: cut at the last space (or hard, inside a long token)
            const space = current.lastIndexOf(' ', maxChars);
            const cut = space > maxChars / 2 ? space : maxChars;
            pieces.push(current.slice(0, cut).trim());
            current = current.slice(cut).trimStart();
        }
    }
    if (current.trim()) pieces.push(current.trim());
    return pieces;
}

function headerValue(headers: Record<string, string> | undefined, name: string): string {
    const key = Object.keys(headers ?? {}).find(k => k.toLowerCase() === name);
    return key ? String(headers![key]) : '';
}

const BINARY_TYPES = /^(application\/(pdf|zip|octet-stream|x-|vnd\.|msword|gzip)|image\/|audio\/|video\/|font\/)/i;

const MAX_REDIRECTS = 5;

/**
 * GET with redirects followed here: Android's HttpURLConnection does not follow them across
 * protocols (http → https), and each hop must be checked against the local network.
 */
async function getFollowingRedirects(url: string): Promise<{ response: HttpResponse; finalUrl: string }> {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const response = await CapacitorHttp.request({
            method: 'GET',
            url: current,
            headers: {
                'User-Agent': BROWSER_USER_AGENT,
                'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
            },
            connectTimeout: 10000,
            readTimeout: 20000,
        });
        const location = headerValue(response.headers, 'location');
        if (response.status >= 300 && response.status < 400 && location) {
            const next = new URL(location, current).toString();
            const unsafe = checkPublicHttpUrl(next);
            if (unsafe) throw new Error(`Redirected to a blocked address (${unsafe})`);
            current = next;
            continue;
        }
        const finalUrl = response.url || current;
        // Redirects followed natively must not lead to the local network either
        const unsafe = finalUrl !== current ? checkPublicHttpUrl(finalUrl) : null;
        if (unsafe) throw new Error(`Redirected to a blocked address (${unsafe})`);
        return { response, finalUrl };
    }
    throw new Error('Too many redirects');
}

async function fetchOnDevice(url: string): Promise<FetchedPage> {
    const { response, finalUrl } = await getFollowingRedirects(url);
    if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP ${response.status}`);
    }

    const contentType = headerValue(response.headers, 'content-type').split(';')[0].trim().toLowerCase();
    if (BINARY_TYPES.test(contentType)) {
        throw new Error(`The URL is a ${contentType} file, not a web page: use download_file to save it`);
    }
    if (typeof response.data !== 'string') {
        return { url: finalUrl, title: '', text: JSON.stringify(response.data, null, 1) };
    }
    if (contentType && !/html|xml/.test(contentType)) {
        return { url: finalUrl, title: '', text: response.data };
    }
    const { title, text } = extractPageText(response.data);
    return { url: finalUrl, title, text };
}

async function fetchOnServer(url: string): Promise<FetchedPage | null> {
    const delegation = getWebDelegation('scraping');
    if (!delegation) return null;
    try {
        const data = await postToServer<{ success?: boolean; data?: string; title?: string; url?: string }>(
            delegation, '/api/web/read', { url }, 30000,
        );
        if (data?.success && typeof data.data === 'string') {
            return { url: data.url || url, title: data.title || '', text: data.data };
        }
        logger.log('warn', '[PageReader] Server returned no content, reading on the device');
    } catch (error) {
        logger.log('warn', '[PageReader] Server read failed, reading on the device', error);
    }
    return null;
}

async function loadPage(url: string): Promise<FetchedPage> {
    const cached = cachedPage(url);
    if (cached) return cached;
    const page = (await fetchOnServer(url)) ?? (await fetchOnDevice(url));
    const bounded = { ...page, text: page.text.slice(0, MAX_PAGE_CHARS) };
    cachePage(url, bounded);
    return bounded;
}

function partIndex(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Reads a page for the model; never throws. */
export async function readWebPage(args: ReadPageArgs): Promise<ReadPageResult> {
    const raw = String(args?.url ?? '').trim();
    const unsafe = checkPublicHttpUrl(raw);
    if (unsafe) return { success: false, message: unsafe };
    const url = new URL(raw).toString();

    let page: FetchedPage;
    try {
        page = await loadPage(url);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        logger.log('warn', `[PageReader] ${url}: ${reason}`);
        return { success: false, message: `Could not read ${url}: ${reason}` };
    }
    if (!page.text.trim()) {
        return { success: false, message: `${url} has no readable text (the page may need JavaScript or a login). Try another result.` };
    }

    const header = `# ${page.title || page.url}\nURL: ${page.url}`;
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    const requestedPart = partIndex(args.chunk_index);

    if (query && requestedPart === undefined) {
        const passages = splitText(page.text, PASSAGE_CHARS);
        if (passages.length > PASSAGES_PER_QUERY) {
            const picked = await selectRelevantPassages(query, passages, PASSAGES_PER_QUERY);
            const body = picked.map(i => passages[i]).join('\n\n[…]\n\n');
            return {
                success: true,
                message: `${header}\n(Passages most relevant to "${query}". To read the page in order use chunk_index, starting from 0.)\n\n${body}`,
                page: { url: page.url, title: page.title },
            };
        }
    }

    const parts = splitText(page.text, PART_CHARS);
    const index = Math.min(requestedPart ?? 0, parts.length - 1);
    let footer = '';
    if (parts.length > 1) {
        footer = index + 1 < parts.length
            ? `\n\n[Part ${index + 1} of ${parts.length}. Next part: read_web_page(${JSON.stringify({ url, chunk_index: index + 1 })})]`
            : `\n\n[Part ${index + 1} of ${parts.length}: end of the page]`;
    }
    return {
        success: true,
        message: `${header}\n\n${parts[index]}${footer}`,
        page: { url: page.url, title: page.title, part: index, parts: parts.length },
    };
}
