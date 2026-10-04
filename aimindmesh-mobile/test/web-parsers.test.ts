import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const embedding = vi.hoisted(() => ({ active: null as null | { modelId: string }, embedText: vi.fn() }));
vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('../src/services/model/embedding/embeddingRuntime', () => ({
    getActiveEmbeddingModel: () => embedding.active,
    embedText: embedding.embedText,
}));

import {
    parseDuckDuckGoHtml, parseDuckDuckGoLite, parseBraveHtml, isDuckDuckGoChallenge, resultTargetUrl,
} from '../src/services/web/searchParsers';
import { decodeHtmlEntities } from '../src/services/web/htmlText';
import { extractPageText } from '../src/services/web/pageExtractor';
import { checkPublicHttpUrl } from '../src/services/web/urlSafety';
import { keywordScores, fuseRankings, selectRelevantPassages, rerankSearchResults } from '../src/services/web/ranking';
import { splitText } from '../src/services/web/pageReader';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', 'web', name), 'utf8');

describe('search result parsers', () => {
    it('reads DuckDuckGo html results one by one: ads skipped, snippets never shifted', () => {
        const results = parseDuckDuckGoHtml(fixture('ddg-html.html'), 10);
        expect(results.map(r => r.url)).toEqual([
            'https://www.mimit.gov.it/it/prezzi',
            'https://example.org/no-snippet',
            'https://www.alvolante.it/prezzo-benzina?utm_source=ddg',
        ]);
        expect(results[0].title).toBe('Prezzi medi dei carburanti – MIMIT');
        expect(results[0].snippet).toBe("I prezzi medi della benzina self sono 1,86 €/l, aggiornati l'1 ottobre.");
        expect(results[1].snippet).toBe('');
        expect(results[2]).toMatchObject({ title: 'Prezzo benzina oggi / alVolante', snippet: 'Tutti i prezzi di benzina e diesel regione per regione.' });
    });

    it('stops at the requested number of results', () => {
        expect(parseDuckDuckGoHtml(fixture('ddg-html.html'), 1)).toHaveLength(1);
    });

    it('reads DuckDuckGo lite results (real page)', () => {
        const results = parseDuckDuckGoLite(fixture('ddg-lite.html'), 10);
        expect(results).toHaveLength(3);
        expect(results[0].url).toBe('https://www.benzina24.it/');
        expect(results[0].title).toContain('Benzina24');
        expect(results[0].snippet).toMatch(/^Confronta i prezzi benzina e gasolio oggi/);
        expect(results.every(r => r.snippet.length > 0 && !r.snippet.includes('<'))).toBe(true);
    });

    it('reads Brave web results and skips clusters (real page)', () => {
        const results = parseBraveHtml(fixture('brave.html'), 10);
        expect(results).toHaveLength(3);
        expect(results[0]).toMatchObject({
            url: 'https://lab24.ilsole24ore.com/prezzo-benzina/',
            title: 'Il prezzo di benzina e gasolio in Italia e in Europa',
        });
        expect(results[0].snippet).toContain('2,110');
        expect(results.every(r => !r.url.includes('search.brave.com'))).toBe(true);
    });

    it('recognizes the DuckDuckGo bot check page', () => {
        expect(isDuckDuckGoChallenge(fixture('ddg-challenge.html'))).toBe(true);
        expect(isDuckDuckGoChallenge(fixture('ddg-lite.html'))).toBe(false);
    });

    it('unwraps result links and drops ads and non-web links', () => {
        expect(resultTargetUrl('//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.com%2Fx&amp;rut=1')).toBe('https://a.com/x');
        expect(resultTargetUrl('https://duckduckgo.com/y.js?ad_domain=x')).toBeNull();
        expect(resultTargetUrl('javascript:alert(1)')).toBeNull();
    });
});

describe('html text', () => {
    it('decodes named and numeric entities', () => {
        expect(decodeHtmlEntities('a &amp; b &#8217;c&#x27; &euro;5 &unknown;')).toBe("a & b ’c' €5 &unknown;");
    });

    it('extracts the main content without scripts, menus and footers', () => {
        const filler = 'Il prezzo medio della benzina self service oggi è 1,86 euro al litro. '.repeat(8);
        const html = `<html><head><title>Fallback</title><meta property="og:title" content="Prezzi &amp; carburanti">
            <script>var tracking = "<p>no</p>";</script><style>p{}</style></head>
            <body><nav><a href="/">Home</a> Menu</nav><header>Site header</header>
            <main><h1>Prezzi oggi</h1><p>${filler}</p><ul><li>Benzina 1,86</li><li>Diesel 1,75</li></ul></main>
            <footer>Cookie policy</footer></body></html>`;
        const { title, text } = extractPageText(html);
        expect(title).toBe('Prezzi & carburanti');
        expect(text).toContain('## Prezzi oggi');
        expect(text).toContain('- Benzina 1,86\n- Diesel 1,75');
        expect(text).not.toMatch(/tracking|Menu|Site header|Cookie policy|<|p\{\}/);
    });

    it('drops banners, dropdowns, hidden elements and link lists with their nested markup', () => {
        const filler = 'La benzina è un liquido infiammabile ottenuto dalla distillazione del petrolio. '.repeat(8);
        const langs = Array.from({ length: 6 }, (_, i) => `<li><a href="/l${i}">Lingua ${i}</a></li>`).join('');
        const html = `<body><div class="cookie-banner"><div><p>Accetta i cookie</p></div><p>Ancora cookie</p></div>
            <main><div class="vector-dropdown"><div><ul>${langs}</ul></div><span>117 lingue</span></div>
            <p data-mw='{"wt":"&lt;ref>{{Cita web|x}}"}'>${filler}</p><div hidden><p>Nascosto</p></div>
            <div style="display: none">Invisibile</div><ul>${langs}</ul><p>Fine articolo</p></main></body>`;
        const { text } = extractPageText(html);
        expect(text).toContain('La benzina è un liquido');
        expect(text).toContain('Fine articolo');
        expect(text).not.toMatch(/cookie|Lingua|117 lingue|Cita web|Nascosto|Invisibile|wt/);
    });

    it('keeps the content wrapper even when its class looks like page chrome', () => {
        const filler = 'Testo principale della pagina con informazioni utili. '.repeat(100);
        const { text } = extractPageText(`<body><div class="page has-sidebar share-layout"><p>${filler}</p></div></body>`);
        expect(text.length).toBeGreaterThan(4000);
    });

    it('falls back to the body without chrome when there is no main content', () => {
        const { title, text } = extractPageText('<title>T</title><body><nav>Menu</nav><div>Short page text</div><footer>F</footer></body>');
        expect(title).toBe('T');
        expect(text).toBe('Short page text');
    });
});

describe('url safety', () => {
    it('allows public http(s) pages only', () => {
        expect(checkPublicHttpUrl('https://www.example.com/a?b=1')).toBeNull();
        expect(checkPublicHttpUrl('http://8.8.8.8/')).toBeNull();
        for (const url of ['http://localhost:3030', 'http://10.2.0.1:3030/api', 'http://192.168.1.1', 'http://172.20.0.5',
            'http://169.254.169.254/latest', 'http://[::1]/', 'http://[fd00::1]/', 'http://router/', 'http://nas.local/',
            'file:///etc/passwd', 'ftp://example.com', 'not a url']) {
            expect(checkPublicHttpUrl(url), url).not.toBeNull();
        }
    });
});

describe('ranking', () => {
    it('scores texts by the query words, ignoring stopwords and accents', () => {
        const scores = keywordScores('perché il prezzo della benzina', ['Il prezzo della benzina è salito', 'Notizie sportive', 'Perche no']);
        expect(scores[0]).toBeGreaterThan(0);
        expect(scores[1]).toBe(0);
        expect(scores[2]).toBe(0);
    });

    it('fuses rankings and keeps the original order on ties', () => {
        // 0 and 2 are first in one list and last in the other: they tie, ahead of 1 (middle in both)
        expect(fuseRankings([[3, 2, 1], [1, 2, 3]])).toEqual([0, 2, 1]);
        expect(fuseRankings([[0, 5, 1]])).toEqual([1, 2, 0]);
    });

    it('picks the passages matching the query, in page order, without embeddings', async () => {
        embedding.active = null;
        const passages = ['Intro del sito', 'Orari di apertura del museo: 9-18', 'Contatti', 'Biglietti del museo: 12 euro', 'Footer'];
        expect(await selectRelevantPassages('biglietti museo prezzo', passages, 2)).toEqual([1, 3]);
        expect(await selectRelevantPassages('xyz', passages, 2)).toEqual([0, 1]);
    });

    it('re-ranks search results with embeddings when the model is loaded', async () => {
        embedding.active = { modelId: 'e5' };
        embedding.embedText.mockImplementation(async (text: string) => ({
            vector: Float32Array.from(text.includes('museo') ? [1, 0] : [0, 1]), key: 'k',
        }));
        const ranked = await rerankSearchResults('museo', [
            { title: 'Sport', url: 'https://a', snippet: 'calcio' },
            { title: 'Musei', url: 'https://b', snippet: 'il museo apre alle 9' },
        ]);
        expect(ranked[0].url).toBe('https://b');
        embedding.active = null;
    });
});

describe('page splitting', () => {
    it('splits at boundaries without losing text', () => {
        const text = ['Primo paragrafo breve.', 'Secondo. '.repeat(40).trim(), 'x'.repeat(130), 'Ultimo.'].join('\n\n');
        const parts = splitText(text, 100);
        expect(parts.every(p => p.length <= 100)).toBe(true);
        expect(parts.join(' ').replace(/\s+/g, '')).toBe(text.replace(/\s+/g, ''));
    });
});
