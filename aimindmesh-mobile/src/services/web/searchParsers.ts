/**
 * Parsers of the search engines' HTML result pages (DuckDuckGo html and lite, Brave).
 *
 * Each result is read as one unit (title link, then its own snippet), never by pairing
 * separate lists of titles and snippets: ads and results without a snippet would shift them.
 */

import { decodeHtmlEntities, inlineText } from './htmlText';

export interface SearchResult {
    title: string;
    url: string;
    snippet: string;
    similarity?: number;
}

/** Snippets longer than this are cut: the model gets several results in a small context. */
export const MAX_SNIPPET_CHARS = 320;

function attr(attrs: string, name: string): string | undefined {
    const match = attrs.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
    return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
}

function hasClass(attrs: string, className: string): boolean {
    return (attr(attrs, 'class') || '').split(/\s+/).includes(className);
}

function clip(text: string, max = MAX_SNIPPET_CHARS): string {
    if (text.length <= max) return text;
    const cut = text.slice(0, max);
    const lastSpace = cut.lastIndexOf(' ');
    return `${cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max).trimEnd()}…`;
}

/**
 * Target of a result link: DuckDuckGo wraps it in a redirect (`/l/?uddg=<target>`).
 * Null for ads, DuckDuckGo's own pages and anything that is not http(s).
 */
export function resultTargetUrl(href: string): string | null {
    let raw = decodeHtmlEntities(href.trim());
    if (raw.startsWith('//')) raw = `https:${raw}`;
    let url: URL;
    try {
        url = new URL(raw, 'https://duckduckgo.com');
    } catch {
        return null;
    }
    const target = url.searchParams.get('uddg');
    if (target) {
        try {
            url = new URL(target);
        } catch {
            return null;
        }
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (/(^|\.)duckduckgo\.com$/i.test(url.hostname)) return null; // ads (y.js) and internal links
    return url.toString();
}

const DDG_MARKERS = /<(a|td|div)\b([^>]*)>/gi;

/**
 * DuckDuckGo results: the html version (`result__a` / `result__snippet`) and the lite
 * version (`result-link` / `result-snippet`) share the shape "title link, then snippet".
 */
function parseDuckDuckGoMarkup(html: string, titleClass: string, snippetClass: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = [];
    let current: (SearchResult & { valid: boolean }) | null = null;
    const flush = () => {
        if (current?.valid && current.title) results.push({ title: current.title, url: current.url, snippet: current.snippet });
        current = null;
    };

    const lower = html.toLowerCase();
    for (const match of html.matchAll(DDG_MARKERS)) {
        const [, tag, attrs] = match;
        const isTitle = tag.toLowerCase() === 'a' && hasClass(attrs, titleClass);
        const isSnippet = hasClass(attrs, snippetClass);
        if (!isTitle && !isSnippet) continue;

        // Content up to the element's own closing tag (titles and snippets hold inline markup only)
        const start = (match.index ?? 0) + match[0].length;
        const end = lower.indexOf(`</${tag.toLowerCase()}`, start);
        const inner = html.slice(start, end === -1 ? undefined : end);

        if (isTitle) {
            flush();
            if (results.length >= maxResults) break;
            const url = resultTargetUrl(attr(attrs, 'href') || '');
            current = { title: inlineText(inner), url: url || '', snippet: '', valid: url !== null };
        } else if (current && !current.snippet) {
            current.snippet = clip(inlineText(inner));
        }
    }
    flush();
    return results.slice(0, maxResults);
}

export const parseDuckDuckGoHtml = (html: string, maxResults: number) =>
    parseDuckDuckGoMarkup(html, 'result__a', 'result__snippet', maxResults);

export const parseDuckDuckGoLite = (html: string, maxResults: number) =>
    parseDuckDuckGoMarkup(html, 'result-link', 'result-snippet', maxResults);

/** DuckDuckGo's bot check ("anomaly" page, served with HTTP 202) instead of results. */
export function isDuckDuckGoChallenge(html: string): boolean {
    return /anomaly-modal|bots use DuckDuckGo too/i.test(html);
}

/** First <div> of the block with the class (exact class name), with its content up to the first </div>. */
function divWithClass(block: string, classNames: string[]): { attrs: string; inner: string } | null {
    for (const match of block.matchAll(/<div\b([^>]*)>/gi)) {
        if (!classNames.some(name => hasClass(match[1], name))) continue;
        const start = (match.index ?? 0) + match[0].length;
        const end = block.indexOf('</div>', start);
        return { attrs: match[1], inner: block.slice(start, end === -1 ? undefined : end) };
    }
    return null;
}

/** Brave Search results page (`<div class="snippet" data-type="web">` blocks). */
export function parseBraveHtml(html: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = [];
    const blocks = html.split(/<div class="snippet\b/).slice(1);

    for (const block of blocks) {
        if (results.length >= maxResults) break;
        const type = attr(block.slice(0, block.indexOf('>')), 'data-type');
        if (type && type !== 'web') continue; // news clusters, videos, ...

        const link = block.match(/<a\b[^>]*\bhref="(https?:\/\/[^"]+)"/);
        const titleDiv = divWithClass(block, ['title']);
        if (!link || !titleDiv) continue;
        const title = inlineText(attr(titleDiv.attrs, 'title') ?? titleDiv.inner);
        const desc = divWithClass(block, ['content', 'snippet-content', 'snippet-description']);
        const url = decodeHtmlEntities(link[1]);

        if (title && !/^https?:\/\/search\.brave\.com\//i.test(url)) {
            results.push({ title, url, snippet: desc ? clip(inlineText(desc.inner)) : '' });
        }
    }
    return results;
}
