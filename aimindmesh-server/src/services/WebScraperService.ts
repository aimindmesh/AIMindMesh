import * as cheerio from 'cheerio';
// @ts-ignore
import pdf from 'pdf-parse-fork';
import { Logger } from '../utils/Logger';
import { getPublicUrl } from '../utils/safeHttp';

export interface ScrapedPage {
  /** Final URL after redirects */
  url: string;
  title: string;
  text: string;
}

const BINARY_TYPES = /^(application\/(zip|octet-stream|x-|vnd\.|msword|gzip)|image\/|audio\/|video\/|font\/)/;
/** Minimum text in <main>/<article> to trust it as the page's content (else the whole body) */
const MIN_MAIN_TEXT = 400;

/** Body bytes → string with the charset of the Content-Type or of the page's <meta charset>. */
function decodeBody(body: Buffer, contentType: string): string {
  const sniff = body.subarray(0, 2048).toString('latin1');
  const charset = contentType.match(/charset=([\w-]+)/)?.[1] || sniff.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] || 'utf-8';
  try {
    return new TextDecoder(charset.toLowerCase()).decode(body);
  } catch {
    return body.toString('utf8');
  }
}

const NOISE_ROLES = 'navigation, banner, search, complementary, contentinfo, dialog, alertdialog'
  .split(', ').map(role => `[role="${role}"]`).join(', ');
const NOISE_TOKENS = new Set(['toc', 'noprint', 'hidden', 'menu', 'ads', 'ad', 'banner', 'related', 'comments', 'mw-editsection', 'catlinks']);
const NOISE_PARTS = ['cookie', 'consent', 'gdpr', 'newsletter', 'advert', 'sponsor', 'breadcrumb', 'navbox', 'sidebar', 'social', 'share', 'popup', 'modal', 'paywall', 'dropdown'];
/** An element matched only by its class/id is dropped when shorter than this (a wrapper of the content never is) */
const MAX_NOISE_TEXT = 4000;

/** Hidden elements, page chrome by ARIA role or class/id, and lists that are only links (menus, language pickers). */
function dropNoise($: cheerio.CheerioAPI): void {
  $(`[hidden], [style*="display:none"], [style*="display: none"], ${NOISE_ROLES}`).not('html, body, main, article').remove();
  $('[class], [id]').not('html, body, main, article').each((_, el) => {
    const $el = $(el);
    const tokens = `${$el.attr('class') || ''} ${$el.attr('id') || ''}`.toLowerCase().split(/\s+/)
      .filter(token => token && !/^(?:has|with|no|is|show)-/.test(token));
    const noisy = tokens.some(token => NOISE_TOKENS.has(token) || NOISE_PARTS.some(part => token.includes(part)));
    if (noisy && $el.text().length < MAX_NOISE_TEXT) $el.remove();
  });
  $('ul, ol').each((_, el) => {
    const items = $(el).children('li');
    if (items.length < 5) return;
    const linkOnly = items.filter((_, li) => {
      const $li = $(li);
      const rest = $li.clone().find('a').remove().end().text().replace(/[\s|·•,;:()\-–]/g, '');
      return $li.find('a').length > 0 && rest.length < 3;
    }).length;
    if (linkOnly / items.length >= 0.8) $(el).remove();
  });
}

/** Readable text of a page: <main>/<article> when it holds the content, else the body without chrome. */
export function extractHtmlText(html: string): { title: string; text: string } {
  const $ = cheerio.load(html);
  const title = ($('meta[property="og:title"]').attr('content') || $('title').first().text() || '').replace(/\s+/g, ' ').trim();
  $('script, style, noscript, template, svg, math, iframe, canvas, button, select, textarea').remove();
  dropNoise($);
  // Paragraph breaks survive .text(): block elements end with a newline
  $('p, div, section, article, li, tr, h1, h2, h3, h4, h5, h6, br, blockquote, pre').after('\n');
  $('td, th').before(' | '); // table cells stay apart

  const clean = (text: string) => text
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');

  const articles = $('article').toArray().sort((a, b) => $(b).text().length - $(a).text().length);
  for (const candidate of [$('main').first(), $(articles[0] ?? []), $('[role="main"]').first()]) {
    if (candidate.length === 0) continue;
    candidate.find('nav, aside, form').remove();
    const text = clean(candidate.text());
    if (text.length >= MIN_MAIN_TEXT) return { title, text };
  }
  $('nav, footer, header, aside, form').remove();
  return { title, text: clean($('body').text() || $.root().text()) };
}

export class WebScraperService {
  private static userAgent = 'Mozilla/5.0 (compatible; AIMindMesh/1.1; research agent)';

  /**
   * Fetches a public page and returns its readable text (HTML, plain text or PDF).
   * Throws on network errors, HTTP errors, private addresses and binary files.
   */
  public static async fetchPage(url: string, timeout: number = 20000): Promise<ScrapedPage> {
    const response = await getPublicUrl(url, {
      timeoutMs: timeout,
      headers: { 'User-Agent': this.userAgent, 'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9,application/pdf;q=0.8,*/*;q=0.5' },
    });
    if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
    const type = response.contentType.split(';')[0].trim();

    if (type === 'application/pdf' || response.body.subarray(0, 5).toString('latin1') === '%PDF-') {
      const parsed = await pdf(response.body);
      return { url: response.url, title: String(parsed.info?.Title || ''), text: String(parsed.text || '').trim() };
    }
    if (BINARY_TYPES.test(type)) throw new Error(`Not a web page (${type})`);

    const body = decodeBody(response.body, response.contentType);
    if (type && !/html|xml/.test(type)) return { url: response.url, title: '', text: body.trim() };
    return { url: response.url, ...extractHtmlText(body) };
  }

  /**
   * Scrapes the content of a URL and returns a cleaned text version ('' when it fails).
   */
  public static async scrape(url: string, timeout: number = 15000): Promise<string> {
    try {
      Logger.debug('WebScraperService', `Scraping URL: ${url}`);
      const page = await this.fetchPage(url, timeout);
      const text = page.text.replace(/\s+/g, ' ').trim();
      Logger.debug('WebScraperService', `Scraped ${text.length} characters from ${url}`);
      return text;
    } catch (err: any) {
      Logger.warn('WebScraperService', `Failed to scrape ${url}: ${err.message}`);
      return '';
    }
  }

  /**
   * Scrapes multiple URLs in parallel with a limit.
   */
  public static async scrapeMultiple(urls: string[], limit: number = 3): Promise<Record<string, string>> {
    const results: Record<string, string> = {};
    const targets = urls.slice(0, limit);

    await Promise.all(targets.map(async (url) => {
      const content = await this.scrape(url);
      if (content) results[url] = content;
    }));

    return results;
  }

  /**
   * The `count` passages of the text that share most words with the query, in page order
   * (the start of the page when no word matches).
   */
  public static relevantPassages(text: string, query: string, count: number = 3, size: number = 800): string[] {
    const passages: string[] = [];
    let current = '';
    for (const line of text.split('\n')) {
      if (current && current.length + line.length + 1 > size) {
        passages.push(current);
        current = '';
      }
      current = current ? `${current}\n${line}` : line.slice(0, size * 2);
    }
    if (current) passages.push(current);
    if (passages.length <= count) return passages;

    const words = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2);
    const terms = new Set(words(query));
    const scores = passages.map(p => words(p).filter(w => terms.has(w)).length);
    if (scores.every(s => s === 0)) return passages.slice(0, count);
    return scores
      .map((score, index) => ({ score, index }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, count)
      .sort((a, b) => a.index - b.index)
      .map(({ index }) => passages[index]);
  }
}
