import axios from 'axios';
import * as cheerio from 'cheerio';
import { Logger } from '../utils/Logger';

export class WebScraperService {
  private static userAgent = 'AIMindMesh/1.1 (Neural Agent; research flow)';

  /**
   * Scrapes the content of a URL and returns a cleaned text version.
   */
  public static async scrape(url: string, timeout: number = 15000): Promise<string> {
    try {
      Logger.debug('WebScraperService', `Scraping URL: ${url}`);
      
      const response = await axios.get(url, {
        headers: { 'User-Agent': this.userAgent },
        timeout,
        responseType: 'text'
      });

      const html = response.data;
      const $ = cheerio.load(html as string);

      // Remove irrelevant elements
      $('script, style, nav, footer, header, iframe, noscript, .ads, .sidebar, #menu, .menu, [role="banner"], [role="navigation"]').remove();

      // Get text from body
      let text = $('body').text();
      
      // Basic cleaning: normalize whitespace
      text = text.replace(/\s+/g, ' ').trim();
      
      // If text is very short, try a broader approach (maybe it's a SPA or has specific layout)
      if (text.length < 200) {
        text = $('html').text().replace(/\s+/g, ' ').trim();
      }

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
}
