/**
 * HTML text helpers for the web tools: entity decoding and tag stripping.
 *
 * String based (no DOM), so it behaves the same in the WebView and in the unit tests.
 */

const NAMED_ENTITIES: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
    hellip: '…', laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
    euro: '€', copy: '©', reg: '®', trade: '™', deg: '°', middot: '·', bull: '•', times: '×',
    agrave: 'à', aacute: 'á', egrave: 'è', eacute: 'é', igrave: 'ì', iacute: 'í',
    ograve: 'ò', oacute: 'ó', ugrave: 'ù', uacute: 'ú', Agrave: 'À', Egrave: 'È', Eacute: 'É',
    Igrave: 'Ì', Ograve: 'Ò', Ugrave: 'Ù', ccedil: 'ç', ntilde: 'ñ', uuml: 'ü', ouml: 'ö', auml: 'ä', szlig: 'ß',
};

/** Decodes named (common ones) and numeric HTML entities. */
export function decodeHtmlEntities(text: string): string {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
        if (body[0] === '#') {
            const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
            return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
        }
        return NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()] ?? match;
    });
}

/**
 * Any tag, with quoted attribute values skipped as a whole: values may contain ">"
 * (e.g. Wikipedia's data-mw JSON), which would otherwise end the tag early.
 */
export const ANY_TAG = /<[a-zA-Z\/!](?:"[^"]*"|'[^']*'|[^'">])*>/g;

/** Inline HTML (a title, a snippet) → one line of text. */
export function inlineText(html: string): string {
    return decodeHtmlEntities(html.replace(/<!--[\s\S]*?-->/g, '').replace(ANY_TAG, ''))
        .replace(/\s+/g, ' ')
        .trim();
}
