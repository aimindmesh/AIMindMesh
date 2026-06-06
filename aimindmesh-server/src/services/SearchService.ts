import axios from 'axios';
import { config } from '../config';
import { Logger } from '../utils/Logger';
import { InferenceRouter } from './InferenceRouter';
import { WebScraperService } from './WebScraperService';

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  engine?: string;
  score?: number;
  similarity?: number;
  isScraped?: boolean;
}

export interface SearchOptions {
  numResults?: number;
  deep?: boolean;
  lang?: string;
}

export class SearchService {
  private static baseUrl = config.search?.searxngUrl || 'http://10.2.0.52:8080';

  /**
   * Performs a web search using SearXNG with RAG re-ranking.
   * @param query The search query.
   * @param numResults Desired number of final results.
   * @returns A list of search results.
   */
  public static async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const numResults = options.numResults || 5;
    const isDeep = options.deep ?? true;

    try {
      const lang = options.lang || this.detectLanguage(query);
      Logger.info('SearchService', `${isDeep ? 'Deep Research' : 'Standard Search'} started for: "${query}" (Lang: ${lang})`);

      // 1. Query Expansion (only for Deep)
      const queries = isDeep ? await this.expandQuery(query) : [query];
      if (isDeep) Logger.debug('SearchService', `Expanded queries: ${queries.join(', ')}`);

      // 2. Parallel SearXNG Retrieval
      const allResults: SearchResult[] = [];
      const seenUrls = new Set<string>();

      await Promise.all(queries.map(async (q) => {
        try {
          const res = await axios.get(this.baseUrl + '/search', {
            params: { q: q, format: 'json', language: lang, safesearch: 0 },
            timeout: 10000,
          });
          const data = res.data as any;
          if (data?.results && Array.isArray(data.results)) {
            for (const r of data.results.slice(0, 8)) {
              if (!seenUrls.has(r.url)) {
                seenUrls.add(r.url);
                allResults.push({
                  title: r.title,
                  url: r.url,
                  content: r.content || r.snippet || '',
                  engine: r.engine,
                  score: r.score,
                });
              }
            }
          }
        } catch (e) {}
      }));

      if (allResults.length === 0) {
        Logger.warn('SearchService', 'No results found from SearXNG after expansion');
        return [];
      }

      // 3. RAG Re-ranking (Initial Selection)
      let selectedResults = allResults;
      if (allResults.length > numResults * 2) {
        selectedResults = await this.rankResults(query, allResults, numResults * 2);
      }

      // 4. Deep Scraping (Crawling top 3 results) - Skip if not deep
      if (isDeep) {
        const topUrls = selectedResults.slice(0, 3).map(r => r.url);
        Logger.info('SearchService', `Deep Research: Scraping top ${topUrls.length} pages...`);
        const scrapedData = await WebScraperService.scrapeMultiple(topUrls, 3);

        // 5. Enrich Context
        const enrichedResults = selectedResults.map(res => {
          if (scrapedData[res.url]) {
            const fullText = scrapedData[res.url];
            return {
              ...res,
              content: fullText.length > 5000 ? fullText.substring(0, 5000) + '... [TRUNCATED]' : fullText,
              isScraped: true
            };
          }
          return res;
        });

        Logger.info('SearchService', `Deep Research complete. Found ${enrichedResults.length} relevant results.`);
        return enrichedResults.slice(0, numResults);
      } else {
        Logger.info('SearchService', `Standard Search complete. Found ${selectedResults.length} results.`);
        return selectedResults.slice(0, numResults);
      }
    } catch (err: any) {
      Logger.error('SearchService', `Search failed: ${err.message}`, { query });
      return [];
    }
  }

  private static detectLanguage(text: string): string {
    const itWords = ['il', 'la', 'che', 'per', 'con', 'e', 'sono', 'questo', 'come', 'perché', 'quando'];
    const words = text.toLowerCase().split(/\s+/);
    const count = words.filter(w => itWords.includes(w)).length;
    return count >= 1 ? 'it-IT' : 'en-US';
  }

  private static async expandQuery(query: string): Promise<string[]> {
    const prompt = `Given the user search request: "${query}", generate 3 distinct and specific search queries in both English and the user's language to get the most comprehensive and updated results.
    Return ONLY a JSON array of strings.
    Format: ["query 1", "query 2", "query 3"]`;

    try {
      const response = await InferenceRouter.complete(prompt, 'QUERY_EXPANSION', { taskName: 'Query Expansion' });
      const match = response.match(/\[.*\]/s);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) return parsed.slice(0, 3);
      }
    } catch (e: any) {
      Logger.warn('SearchService', `Query expansion failed: ${e.message}. Using original query.`);
    }
    return [query];
  }

  private static async rankResults(query: string, results: SearchResult[], limit: number): Promise<SearchResult[]> {
    try {
      const queryEmbedding = await InferenceRouter.getEmbeddings(query);
      const similarities = await Promise.all(results.map(async (res) => {
        if (!res.content) return { ...res, similarity: -1 };
        try {
          const chunkEmbedding = await InferenceRouter.getEmbeddings(res.content.substring(0, 1000));
          let dotProduct = 0, normA = 0, normB = 0;
          for (let i = 0; i < queryEmbedding.length; i++) {
            dotProduct += queryEmbedding[i] * chunkEmbedding[i];
            normA += queryEmbedding[i] * queryEmbedding[i];
            normB += chunkEmbedding[i] * chunkEmbedding[i];
          }
          const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
          return { ...res, similarity };
        } catch (e) { return { ...res, similarity: -1 }; }
      }));

      return similarities
        .sort((a: any, b: any) => b.similarity - a.similarity)
        .slice(0, limit);
    } catch (e) {
      return results.slice(0, limit);
    }
  }

  /**
   * Formats search results into a context string for the LLM.
   */
  public static formatResultsForContext(results: SearchResult[]): string {
    if (results.length === 0) return "No relevant web search results found.";

    let context = "WEB SEARCH RESULTS:\n\n";
    results.forEach((res, index) => {
      context += `[${index + 1}] ${res.title}\n`;
      context += `Source: ${res.url}\n`;
      context += `Content: ${res.content}\n\n`;
    });

    context += "INSTRUCTIONS FOR CITATIONS:\n";
    context += "1. Use the search results to inform your answer.\n";
    context += "2. At the end of your response, provide a 'References' section listing the sources used by their index number [n].\n";
    context += "3. If a result is irrelevant, ignore it.\n";

    return context;
  }
}
