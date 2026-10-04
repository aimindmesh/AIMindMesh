/**
 * Readable text of an HTML page for read_web_page: the <main>/<article> content when it
 * holds the page's text, otherwise the body. Menus, cookie banners, share bars, hidden
 * elements, dropdowns and lists of links are dropped.
 *
 * A small tag scanner (quoted attributes aware) removes elements with their nested
 * children balanced, which plain regular expressions cannot do. No DOM: same behavior in
 * the WebView and in the unit tests.
 */

import { ANY_TAG, decodeHtmlEntities, inlineText } from './htmlText';

/** Raw-text and non-content elements, dropped with their content before scanning. */
const RAW_ELEMENTS = ['script', 'style', 'noscript', 'template', 'svg', 'math', 'canvas', 'iframe', 'object', 'select', 'button', 'textarea', 'head'];
const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
/** Page chrome: dropped from the body; inside <main>/<article> only nav, aside and form. */
const CHROME_ELEMENTS = new Set(['nav', 'aside', 'footer', 'form', 'header']);
const NOISE_ROLES = new Set(['navigation', 'banner', 'search', 'complementary', 'contentinfo', 'dialog', 'alertdialog']);
const NOISE_TOKENS = new Set(['toc', 'noprint', 'hidden', 'menu', 'ads', 'ad', 'banner', 'related', 'comments', 'mw-editsection', 'catlinks']);
const NOISE_PARTS = ['cookie', 'consent', 'gdpr', 'newsletter', 'advert', 'sponsor', 'breadcrumb', 'navbox', 'sidebar', 'social', 'share', 'popup', 'modal', 'paywall', 'dropdown'];
/** An element matched only by its class/id is dropped when shorter than this (a wrapper of the content never is). */
const MAX_NOISE_TEXT = 4000;
/** Minimum text in <main>/<article> to trust it as the page's content (else the whole body). */
const MIN_MAIN_TEXT = 400;

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
const BLOCK_TAGS = /<\/?(?:p|div|section|article|main|br|hr|li|ul|ol|dl|dt|dd|tr|table|thead|tbody|blockquote|pre|figure|figcaption|h[1-6])\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi;

interface Tag { start: number; end: number; name: string; closing: boolean; attrs: string }
interface Range { tag: Tag; start: number; contentStart: number; contentEnd: number; end: number }

export function getAttribute(attrs: string, name: string): string | undefined {
    const match = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
    return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
}

function scanTags(html: string): Tag[] {
    return [...html.matchAll(TAG)].map(m => ({
        start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, name: m[2].toLowerCase(), closing: m[1] === '/', attrs: m[3],
    }));
}

/**
 * Outermost elements whose opening tag matches, each up to its balanced closing tag
 * (elements never closed are skipped).
 */
function findElements(tags: Tag[], match: (tag: Tag) => boolean): Range[] {
    const found: Range[] = [];
    for (let i = 0; i < tags.length; i++) {
        const open = tags[i];
        if (open.closing || VOID_ELEMENTS.has(open.name) || open.attrs.trimEnd().endsWith('/') || !match(open)) continue;
        let depth = 1;
        for (let j = i + 1; j < tags.length; j++) {
            if (tags[j].name !== open.name) continue;
            depth += tags[j].closing ? -1 : 1;
            if (depth === 0) {
                found.push({ tag: open, start: open.start, contentStart: open.end, contentEnd: tags[j].start, end: tags[j].end });
                i = j; // nested matches go with it
                break;
            }
        }
    }
    return found;
}

function removeRanges(html: string, ranges: Range[]): string {
    let out = '';
    let last = 0;
    for (const range of ranges) {
        out += html.slice(last, range.start) + '\n';
        last = range.end;
    }
    return out + html.slice(last);
}

/** 'always' (hidden, ARIA role of page chrome), 'short' (class/id of page chrome) or false. */
function noiseKind(tag: Tag): 'always' | 'short' | false {
    if (['html', 'body', 'main', 'article'].includes(tag.name)) return false;
    const attrs = tag.attrs;
    if (/(?:^|\s)hidden(?:\s|=|\/|$)/i.test(attrs)) return 'always';
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(getAttribute(attrs, 'style') || '')) return 'always';
    if (NOISE_ROLES.has((getAttribute(attrs, 'role') || '').toLowerCase())) return 'always';
    const tokens = `${getAttribute(attrs, 'class') || ''} ${getAttribute(attrs, 'id') || ''}`.toLowerCase().split(/\s+/)
        .filter(token => token && !/^(?:has|with|no|is|show)-/.test(token)); // state classes of wrappers
    return tokens.some(token => NOISE_TOKENS.has(token) || NOISE_PARTS.some(part => token.includes(part))) ? 'short' : false;
}

function dropNoise(html: string): string {
    const ranges = findElements(scanTags(html), tag => noiseKind(tag) !== false).filter(range =>
        noiseKind(range.tag) === 'always'
        || html.slice(range.contentStart, range.contentEnd).replace(ANY_TAG, '').length < MAX_NOISE_TEXT);
    return removeRanges(html, ranges);
}

function dropTags(html: string, names: Set<string>): string {
    return removeRanges(html, findElements(scanTags(html), tag => names.has(tag.name)));
}

/** Lists of links only (menus, "related" lists not marked as nav): 5+ items, 80% just a link. */
function dropLinkLists(html: string): string {
    const ranges = findElements(scanTags(html), tag => tag.name === 'ul' || tag.name === 'ol').filter(range => {
        const items = html.slice(range.contentStart, range.contentEnd).split(/<li\b/i).slice(1)
            .map(item => item.slice(item.indexOf('>') + 1));
        if (items.length < 5) return false;
        const linkOnly = items.filter(item => /<a\b/i.test(item)
            && inlineText(item.replace(/<a\b[\s\S]*?<\/a\s*>/gi, '')).replace(/[\s|·•,;:()\-–]/g, '').length < 3);
        return linkOnly.length / items.length >= 0.8;
    });
    return removeRanges(html, ranges);
}

/** Block markup → text with paragraphs on separate lines. */
function blocksToText(html: string): string {
    const text = decodeHtmlEntities(
        html
            .replace(/<\/li\s*>/gi, '')
            .replace(/<li\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi, '\n- ')
            .replace(/<h[1-6]\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi, '\n\n## ')
            .replace(/<(?:td|th)\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi, ' | ')
            .replace(BLOCK_TAGS, '\n')
            .replace(ANY_TAG, '')
    );
    return text
        .split('\n')
        .map(line => line.replace(/[ \t\f\v ]+/g, ' ').trim())
        .filter((line, i, lines) => line !== '' || (i > 0 && lines[i - 1] !== ''))
        .join('\n')
        .replace(/^(?:## |- |\|)\s*$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/(?<=^(?:- |\| )[^\n]*)\n\n(?=- |\| )/gm, '\n') // list items and table rows stay together
        .trim();
}

export interface PageText {
    title: string;
    text: string;
}

export function extractPageText(html: string): PageText {
    const titleMatch = html.match(/<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["']/i)
        || html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? inlineText(titleMatch[1]) : '';

    let clean = html.replace(/<!--[\s\S]*?-->/g, '');
    for (const tag of RAW_ELEMENTS) {
        clean = clean.replace(new RegExp(`<${tag}\\b(?:"[^"]*"|'[^']*'|[^'">])*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), ' ');
    }
    clean = dropLinkLists(dropNoise(clean));

    const tags = scanTags(clean);
    const main = findElements(tags, tag => tag.name === 'main')[0];
    const articles = findElements(tags, tag => tag.name === 'article')
        .sort((a, b) => (b.contentEnd - b.contentStart) - (a.contentEnd - a.contentStart));
    for (const range of [main, articles[0]]) {
        if (!range) continue;
        const text = blocksToText(dropTags(clean.slice(range.contentStart, range.contentEnd), new Set(['nav', 'aside', 'form'])));
        if (text.length >= MIN_MAIN_TEXT) return { title, text };
    }

    const body = findElements(tags, tag => tag.name === 'body')[0];
    const bodyHtml = body ? clean.slice(body.contentStart, body.contentEnd) : clean;
    const text = blocksToText(dropTags(bodyHtml, CHROME_ELEMENTS));
    // A page that is all chrome (e.g. a short landing page): better its chrome than nothing
    return { title, text: text.length > 0 ? text : blocksToText(bodyHtml) };
}
