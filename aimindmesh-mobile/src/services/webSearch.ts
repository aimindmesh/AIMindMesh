/**
 * Web Search Service
 * 
 * Provides lightweight web search functionality using DuckDuckGo HTML interface.
 * No API key required - uses HTML scraping for basic search.
 */

import { logger } from './logger';
import { CapacitorHttp } from '@capacitor/core';
import { TextEmbedding } from 'text-embedding-capacitor';

export interface SearchResult {
    title: string;
    url: string;
    snippet: string;
    similarity?: number;
}

export interface WebSearchResult {
    success: boolean;
    query: string;
    results: SearchResult[];
    error?: string;
}

/**
 * Search the web using DuckDuckGo HTML interface
 * This is a lightweight approach that doesn't require API keys
 */
export async function searchWeb(query: string, numResults: number = 3): Promise<WebSearchResult> {
    const maxResults = Math.min(numResults, 5); // Cap at 5 to avoid abuse

    try {
        const storedSettings = localStorage.getItem('appSettings');
        const settings = storedSettings ? JSON.parse(storedSettings) : null;
        const aiServer = settings?.aimindmeshServer;

        // Delegate to AIMindMesh Server if enabled (replaces legacy Support Server)
        if (aiServer?.enabled && aiServer?.delegateWebSearch && aiServer?.serverUrl) {
            logger.log('info', `Delegating web search to AIMindMesh Server: ${aiServer.serverUrl}`);
            try {
                const response = await CapacitorHttp.request({
                    method: 'POST',
                    url: `${aiServer.serverUrl.replace(/\/$/, '')}/api/web/search`,
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': aiServer.apiKey || '',
                    },
                    data: {
                        query: query,
                        num_results: numResults
                    },
                    connectTimeout: 10000,
                    readTimeout: 15000,
                });

                if (response.status === 200 && response.data) {
                    const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
                    if (data.success && data.results) {
                        logger.log('info', `AIMindMesh Server returned ${data.results.length} results`);
                        return {
                            success: true,
                            query,
                            results: data.results
                        };
                    }
                }
                logger.log('warn', 'AIMindMesh Server search failed or returned invalid data, falling back to local DuckDuckGo scrape');
            } catch (serverError) {
                logger.log('error', 'Error calling AIMindMesh Server for search, falling back to DuckDuckGo', serverError);
            }
        }

        logger.log('info', `Web search (local fallback): "${query}"`, { numResults: maxResults });

        // Use DuckDuckGo HTML interface
        const encodedQuery = encodeURIComponent(query);
        const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

        let html: string;
        let results: SearchResult[];
        const fetchResults = Math.max(20, maxResults);

        try {
            const response = await CapacitorHttp.request({
                method: 'GET',
                url: url,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Android; Mobile) AppleWebKit/537.36',
                    'Accept': 'text/html',
                }
            });

            if (response.status !== 200) {
                throw new Error(`Search request failed: ${response.status}`);
            }

            html = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
            results = parseDuckDuckGoResults(html, fetchResults);
            
            if (results.length === 0) {
                throw new Error("No results parsed from DuckDuckGo");
            }
        } catch (ddgError: any) {
            logger.log('warn', `DuckDuckGo local search failed, falling back to Brave Search. Error: ${ddgError.message || ddgError}`);
            
            const braveUrl = `https://search.brave.com/search?q=${encodedQuery}`;
            const braveResponse = await CapacitorHttp.request({
                method: 'GET',
                url: braveUrl,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Android; Mobile) AppleWebKit/537.36',
                    'Accept': 'text/html',
                }
            });

            if (braveResponse.status !== 200) {
                throw new Error(`Brave Search fallback failed: ${braveResponse.status}`);
            }

            html = typeof braveResponse.data === 'string' ? braveResponse.data : JSON.stringify(braveResponse.data);
            results = parseBraveSearchResults(html, fetchResults);
        }

        // --- RAG Re-ranking Logic ---
        if (results.length > maxResults) {
            try {
                logger.log('info', `RAG: Re-ranking ${results.length} results using text embeddings...`);

                // Embed the query
                const queryEmbeddingRes = await TextEmbedding.generateEmbedding({ text: query });
                const queryEmbedding = queryEmbeddingRes.embedding;

                // Embed all snippets and compute similarities
                const similarities = await Promise.all(results.map(async (r: SearchResult) => {
                    if (!r.snippet) return { ...r, similarity: -1 }; // Skip empty snippets

                    try {
                        const snippetRes = await TextEmbedding.generateEmbedding({ text: r.snippet });
                        const snippetEmbedding = snippetRes.embedding;

                        // Compute cosine similarity
                        let dotProduct = 0;
                        let normQuery = 0;
                        let normSnippet = 0;
                        for (let i = 0; i < queryEmbedding.length; i++) {
                            dotProduct += queryEmbedding[i] * snippetEmbedding[i];
                            normQuery += queryEmbedding[i] * queryEmbedding[i];
                            normSnippet += snippetEmbedding[i] * snippetEmbedding[i];
                        }

                        const similarity = dotProduct / (Math.sqrt(normQuery) * Math.sqrt(normSnippet));
                        return { ...r, similarity };
                    } catch (err) {
                        return { ...r, similarity: -1 };
                    }
                }));

                // Sort by descending similarity and slice to requested maxResults
                results = similarities
                    .sort((a: any, b: any) => (b.similarity || 0) - (a.similarity || 0))
                    .slice(0, maxResults);

                logger.log('info', `RAG: Re-ranking complete. Top similarity: ${results[0]?.similarity?.toFixed(3)}`);
            } catch (embedError) {
                logger.log('warn', 'RAG: Failed to perform embedding-based re-ranking, falling back to chronological DDG results.', embedError);
                results = results.slice(0, maxResults);
            }
        }

        logger.log('info', `Web search returned ${results.length} results`);

        return {
            success: true,
            query,
            results
        };
    } catch (error) {
        logger.log('error', 'Web search failed', error);
        return {
            success: false,
            query,
            results: [],
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Parse DuckDuckGo HTML results page
 */
function parseDuckDuckGoResults(html: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = [];

    // Pattern to match result blocks
    // DuckDuckGo HTML uses <a class="result__a" href="...">title</a>
    // and <a class="result__snippet">snippet</a>

    // Simple regex-based parsing (works for basic cases)
    const resultPattern = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
    const snippetPattern = /<a[^>]*class="result__snippet"[^>]*>([^<]*(?:<[^>]*>[^<]*)*)<\/a>/gi;

    let match;
    const titles: { url: string; title: string }[] = [];

    // Extract titles and URLs
    while ((match = resultPattern.exec(html)) !== null && titles.length < maxResults) {
        let url = match[1];
        const title = decodeHTMLEntities(match[2].trim());

        // DuckDuckGo uses redirect URLs, extract the actual URL
        if (url.includes('uddg=')) {
            const uddgMatch = url.match(/uddg=([^&]*)/);
            if (uddgMatch) {
                url = decodeURIComponent(uddgMatch[1]);
            }
        }

        if (url && title && !url.includes('duckduckgo.com')) {
            titles.push({ url, title });
        }
    }

    // Extract snippets
    const snippets: string[] = [];
    while ((match = snippetPattern.exec(html)) !== null && snippets.length < maxResults) {
        const snippet = decodeHTMLEntities(
            match[1].replace(/<[^>]*>/g, '').trim()
        );
        if (snippet) {
            snippets.push(snippet);
        }
    }

    // Combine results
    for (let i = 0; i < Math.min(titles.length, maxResults); i++) {
        results.push({
            title: titles[i].title,
            url: titles[i].url,
            snippet: snippets[i] || ''
        });
    }

    return results;
}

/**
 * Parse Brave Search HTML results page
 */
function parseBraveSearchResults(html: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = [];
    const blocks = html.split('<div class="snippet');
    
    for (let i = 1; i < blocks.length; i++) {
        if (results.length >= maxResults) break;
        
        const block = blocks[i];
        
        const urlMatch = block.match(/<a[^>]+href="([^"]+)"/);
        const titleMatch = block.match(/<div[^>]*class="title[^>]*>([^<]+)/);
        const descMatch = block.match(/<div[^>]*class="snippet-content[^>]*>(.*?)<\/div>/) || 
                          block.match(/<div[^>]*class="snippet-description[^>]*>(.*?)<\/div>/) || 
                          block.match(/<div[^>]*class="[^"]*snippet[^"]*".*?>.*?<div.*?>(.*?)<\/div>/);
                          
        if (urlMatch && titleMatch) {
            let url = urlMatch[1];
            let title = decodeHTMLEntities(titleMatch[1].trim());
            let snippet = descMatch ? decodeHTMLEntities(descMatch[1].replace(/<[^>]+>/g, '').trim()) : '';
            
            if (url && title && !url.includes('search.brave.com')) {
                results.push({ url, title, snippet });
            }
        }
    }
    
    return results;
}

/**
 * Decode HTML entities
 */
function decodeHTMLEntities(text: string): string {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, '/');
}

/**
 * Format search results for LLM context injection
 */
export function formatSearchResultsForContext(results: SearchResult[]): string {
    if (results.length === 0) {
        return '[No web results found]';
    }

    const formatted = results.map((r, i) =>
        `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`
    ).join('\n\n');

    return `## Web Search Results\n\n${formatted}`;
}
