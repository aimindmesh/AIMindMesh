import { Type } from '@google/genai';
import { ToolDefinition, ToolResult } from './types';
import { searchWeb, formatSearchResultsForContext, parseTimeRange, DEFAULT_RESULTS, MAX_RESULTS } from '../web/webSearch';
import { readWebPage } from '../web/pageReader';
import { getWebDelegation, postToServer } from '../web/webDelegation';
import { logger } from '../logger';

export const webTools: ToolDefinition[] = [
    {
        name: 'search_web',
        description: `Searches the web and returns results with title, URL and snippet (up to ${MAX_RESULTS}). Use it for current events, prices, schedules, facts you are not sure about. Answer from the snippets only when they clearly contain the answer; otherwise call read_web_page on the most relevant URL. Cite the URLs you use.`,
        parameters: {
            type: Type.OBJECT,
            properties: {
                query: {
                    type: Type.STRING,
                    description: 'The search query, a few keywords in the language of the expected results (e.g., "prezzo benzina oggi", "Gemma 3 release notes")'
                },
                num_results: {
                    type: Type.NUMBER,
                    description: `Number of results (default: ${DEFAULT_RESULTS}, max: ${MAX_RESULTS})`
                },
                time_range: {
                    type: Type.STRING,
                    description: 'Optional: only results from the last day, week, month or year. Use it for news, prices and "today"/"latest" questions.',
                    enum: ['day', 'week', 'month', 'year']
                }
            },
            required: ['query']
        },
        requiresConfirmation: false,
        category: 'web'
    },
    {
        name: 'read_web_page',
        description: 'Reads the text of a public web page (articles, documentation, results found with search_web). Long pages come in parts: pass query to get only the passages relevant to it, or chunk_index to read a given part. Do NOT use it to download files.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                url: {
                    type: Type.STRING,
                    description: 'The URL to read (must start with http:// or https://)'
                },
                query: {
                    type: Type.STRING,
                    description: 'Optional: what you are looking for in the page; returns only the most relevant passages'
                },
                chunk_index: {
                    type: Type.NUMBER,
                    description: 'Optional: the part of the page to read (0-based). The result says how many parts the page has.'
                }
            },
            required: ['url']
        },
        requiresConfirmation: false,
        category: 'web'
    },
    {
        name: 'open_browser',
        description: 'Opens a URL in the default web browser.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                url: {
                    type: Type.STRING,
                    description: 'The URL to open (must start with http:// or https://)'
                }
            },
            required: ['url']
        },
        requiresConfirmation: true,
        category: 'web'
    },
    {
        name: 'search_maps',
        description: 'Opens Google Maps with a search query or directions.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                query: {
                    type: Type.STRING,
                    description: 'Location or place to search for (e.g., "pizza near me", "Rome, Italy")'
                },
                navigate_to: {
                    type: Type.STRING,
                    description: 'Optional: Address to get directions to'
                }
            },
            required: ['query']
        },
        requiresConfirmation: false,
        category: 'system'
    },
    {
        name: 'analyze_web',
        description: 'Delegates a web research to the AIMindMesh Server: it searches, reads the top pages and returns a synthesized answer with sources. Slower than search_web; use it for questions that need several sources.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                query: {
                    type: Type.STRING,
                    description: 'The question to research'
                }
            },
            required: ['query']
        },
        requiresConfirmation: false,
        category: 'web',
        // Offered to the model only when the server does the analysis
        isAvailable: () => getWebDelegation('analysis') !== null
    }
];

export async function executeSearchWeb(args: { query: string; num_results?: number; time_range?: string }): Promise<ToolResult> {
    const query = String(args?.query ?? '').trim();
    if (!query) return { success: false, message: 'Missing search query' };

    const result = await searchWeb(query, { numResults: args.num_results, timeRange: parseTimeRange(args.time_range) });
    if (!result.success) {
        return { success: false, message: `Search failed: ${result.error || 'unknown error'}` };
    }
    if (result.results.length === 0) {
        return { success: false, message: `No results for "${query}". Try different or fewer keywords.` };
    }
    return {
        success: true,
        message: formatSearchResultsForContext(result.results, query),
        data: result.results,
        sources: result.results.map(r => ({ title: r.title, uri: r.url }))
    };
}

export async function executeReadWebPage(args: { url: string; query?: string; chunk_index?: number }): Promise<ToolResult> {
    const result = await readWebPage(args);
    return {
        success: result.success,
        message: result.message,
        data: result.page,
        sources: result.success && result.page ? [{ title: result.page.title || result.page.url, uri: result.page.url }] : undefined
    };
}

export async function executeOpenBrowser(args: { url: string }): Promise<ToolResult> {
    try {
        window.open(args.url, '_system');
        return { success: true, message: `Opened ${args.url}` };
    } catch (e: any) {
        return { success: false, message: "Failed to open browser: " + e.message };
    }
}

export async function executeSearchMaps(args: { query: string; navigate_to?: string }): Promise<ToolResult> {
    try {
        let url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(args.query)}`;
        if (args.navigate_to) {
            url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(args.navigate_to)}`;
        }
        window.open(url, '_system');
        return { success: true, message: "Opened Maps" };
    } catch (e: any) {
        return { success: false, message: "Failed to open maps" };
    }
}

export async function executeAnalyzeWeb(args: { query: string }): Promise<ToolResult> {
    const delegation = getWebDelegation('analysis');
    if (!delegation) {
        return {
            success: false,
            message: "Web analysis needs the AIMindMesh Server: enable it in Settings → AIMindMesh Server → Web tools. Use search_web instead."
        };
    }
    try {
        logger.log('info', `[analyze_web] Delegating to ${delegation.baseUrl}`);
        const data = await postToServer<{ success?: boolean; data?: string; error?: string }>(
            delegation, '/api/web/analyze', { query: args.query }, 120000
        );
        if (data?.success && data.data) {
            return { success: true, message: data.data, data: data.data };
        }
        return { success: false, message: data?.error || 'Analysis failed on the server' };
    } catch (e: any) {
        logger.log('error', '[analyze_web] Server analysis failed', e);
        return { success: false, message: 'Analysis failed: ' + (e?.message || e) };
    }
}
