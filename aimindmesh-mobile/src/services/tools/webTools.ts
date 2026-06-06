import { Type } from '@google/genai';
import { ToolDefinition, ToolResult } from './types';
import { searchWeb, formatSearchResultsForContext } from '../webSearch';
import { logger } from '../logger';
import { TextEmbedding } from 'text-embedding-capacitor';
import { DocumentChunker } from '../documents/DocumentChunker';

export const webTools: ToolDefinition[] = [
    {
        name: 'search_web',
        description: 'Searches the web for information using DuckDuckGo and returns results with titles, snippets, and URLs. Use these results to answer questions and provide source links. Returns up to 5 results. If you need to read full page content, use read_web_page with one of the returned URLs.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                query: {
                    type: Type.STRING,
                    description: 'The search query (e.g., "download link for model X", "latest news about Y")'
                },
                num_results: {
                    type: Type.NUMBER,
                    description: 'Number of results to return (default: 3, max: 5)'
                }
            },
            required: ['query']
        },
        requiresConfirmation: false,
        category: 'web'
    },
    {
        name: 'read_web_page',
        description: 'Reads the text content of a web page. Use this for reading articles or documentation. Do NOT use for downloading files.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                url: {
                    type: Type.STRING,
                    description: 'The URL to fetch (must start with http:// or https://)'
                },
                query: {
                    type: Type.STRING,
                    description: 'Optional: If you are looking for specific information within a very long page, provide a semantic query to return only the most relevant chunks instead of the entire page.'
                },
                method: {
                    type: Type.STRING,
                    description: 'HTTP method to use',
                    enum: ['GET', 'POST']
                },
                headers: {
                    type: Type.STRING,
                    description: 'Optional JSON string of headers (e.g., {"Authorization": "Bearer token"})'
                },
                body: {
                    type: Type.STRING,
                    description: 'Optional request body for POST requests'
                },
                chunk_index: {
                    type: Type.NUMBER,
                    description: 'Optional: The chunk index to read (0-based). Example: 0 for first chunk, 1 for next. If omitted, returns first chunk.'
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
        description: '[SERVER ONLY] Delegates web search and full LLM synthesis of the results to the external Support Server. Helps prevent local OOM. Use this when you need deep analysis of a topic via the web.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                query: {
                    type: Type.STRING,
                    description: 'The query to search and analyze'
                }
            },
            required: ['query']
        },
        requiresConfirmation: false,
        category: 'web'
    }
];

export async function executeSearchWeb(args: { query: string; num_results?: number }): Promise<ToolResult> {
    try {
        const result = await searchWeb(args.query, args.num_results || 3);

        if (!result.success || result.results.length === 0) {
            return {
                success: false,
                message: result.error || "No search results found"
            };
        }

        // Format results for the model to use
        const formattedResults = formatSearchResultsForContext(result.results);

        return {
            success: true,
            message: formattedResults,
            data: result.results
        };
    } catch (e: any) {
        return { success: false, message: "Search failed: " + e.message };
    }
}

export async function executeReadWebPage(args: { url: string; query?: string; method?: string; headers?: string; body?: string }): Promise<ToolResult> {
    try {
        const { CapacitorHttp } = await import('@capacitor/core');
        const storedSettings = localStorage.getItem('appSettings');
        const settings = storedSettings ? JSON.parse(storedSettings) : null;
        const aiServer = settings?.aimindmeshServer;

        // Delegate to AIMindMesh Server if enabled (replaces legacy Support Server)
        if (aiServer?.enabled && aiServer?.delegateWebScraping && aiServer?.serverUrl) {
            logger.log('info', `Delegating web scraping to AIMindMesh Server: ${aiServer.serverUrl} for ${args.url}`);
            try {
                const response = await CapacitorHttp.request({
                    method: 'POST',
                    url: `${aiServer.serverUrl.replace(/\/$/, '')}/api/web/read`,
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': aiServer.apiKey || '',
                    },
                    data: {
                        url: args.url,
                        query: args.query,
                        method: args.method || 'GET',
                        headers: args.headers,
                        body: args.body
                    },
                    connectTimeout: 10000,
                    readTimeout: 30000,
                });

                if (response.status === 200 && response.data) {
                    const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
                    if (data.success && data.data) {
                        logger.log('info', `AIMindMesh Server successfully read web page (length: ${data.data.length})`);
                        return { success: true, message: "Read content successfully", data: data.data.substring(0, 50000) };
                    }
                }
                logger.log('warn', 'AIMindMesh Server scraping failed or returned invalid data, falling back to local scraping');
            } catch (serverError) {
                logger.log('error', 'Error calling AIMindMesh Server for scraping, falling back to local execution', serverError);
            }
        }

        // Use CapacitorHttp instead of fetch to bypass CORS locally
        const response = await CapacitorHttp.request({
            method: (args.method || 'GET') as any,
            url: args.url,
            headers: args.headers ? JSON.parse(args.headers) : {
                'User-Agent': 'Mozilla/5.0 (Android; Mobile) AppleWebKit/537.36',
            },
            data: args.body,
        });

        if (response.status !== 200) {
            throw new Error(`HTTP ${response.status}`);
        }

        const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

        if (!args.query) {
            return { success: true, message: "Read content successfully", data: text.substring(0, 10000) }; // Truncate
        }

        // --- RAG Processing for Specific Query ---
        logger.log('info', `RAG: Processing ${text.length} characters of page content for query "${args.query}"`);

        // 1. Chunk the document
        const documentChunker = new DocumentChunker();
        const chunksResult = await documentChunker.chunk(text, 'recursive', 512, 50);
        const chunks = chunksResult.map((c: any) => c.content);

        logger.log('info', `RAG: Split page into ${chunks.length} chunks`);

        // 2. Embed query
        const queryEmbeddingRes = await TextEmbedding.generateEmbedding({ text: args.query });
        const queryEmbedding = queryEmbeddingRes.embedding;

        // 3. Embed chunks and calculate similarity
        const similarities = await Promise.all(chunks.map(async (chunkText: string, index: number) => {
            try {
                const chunkEmbeddingRes = await TextEmbedding.generateEmbedding({ text: chunkText });
                const chunkEmbedding = chunkEmbeddingRes.embedding;

                let dotProduct = 0;
                let normQuery = 0;
                let normChunk = 0;
                for (let i = 0; i < queryEmbedding.length; i++) {
                    dotProduct += queryEmbedding[i] * chunkEmbedding[i];
                    normQuery += queryEmbedding[i] * queryEmbedding[i];
                    normChunk += chunkEmbedding[i] * chunkEmbedding[i];
                }

                const similarity = dotProduct / (Math.sqrt(normQuery) * Math.sqrt(normChunk));
                return { text: chunkText, similarity, index };
            } catch (e) {
                return { text: chunkText, similarity: -1, index };
            }
        }));

        // 4. Sort and select top chunks
        const topChunks = similarities
            .sort((a: any, b: any) => b.similarity - a.similarity)
            .slice(0, 5); // Return top 5 chunks max

        logger.log('info', `RAG: Page analysis complete. Top chunk similarity: ${topChunks[0]?.similarity?.toFixed(3)}`);

        // Reorder sequentially for context logic
        const sequentialChunks = topChunks.sort((a: any, b: any) => a.index - b.index);
        const combinedText = sequentialChunks.map((c: any) => c.text).join('\n\n...\n\n');

        return {
            success: true,
            message: `Extracted ${topChunks.length} most relevant sections based on query.`,
            data: combinedText
        };

    } catch (e: any) {
        return { success: false, message: "Failed to read web page: " + e.message };
    }
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
    try {
        const { CapacitorHttp } = await import('@capacitor/core');
        const storedSettings = localStorage.getItem('appSettings');
        const settings = storedSettings ? JSON.parse(storedSettings) : null;
        const aiServer = settings?.aimindmeshServer;

        if (!aiServer?.enabled || !aiServer?.delegateWebAnalysis || !aiServer?.serverUrl) {
            return {
                success: false,
                message: "AIMindMesh Server Web Analysis is disabled. Enable 'Delegate Web Analysis' in Server settings."
            };
        }

        logger.log('info', `Delegating web analysis to AIMindMesh Server: ${aiServer.serverUrl}`);
        const response = await CapacitorHttp.request({
            method: 'POST',
            url: `${aiServer.serverUrl.replace(/\/$/, '')}/api/web/analyze`,
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': aiServer.apiKey || '',
            },
            data: {
                query: args.query
            },
            connectTimeout: 10000,
            readTimeout: 120000,
        });

        if (response.status === 200 && response.data) {
            const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
            if (data.success && data.data) {
                return { success: true, message: "Analysis complete", data: data.data };
            }
            return { success: false, message: data.error || "Analysis failed on server" };
        }

        throw new Error(`HTTP ${response.status}`);
    } catch (e: any) {
        logger.log('error', 'Error calling AIMindMesh Server for analysis', e);
        return { success: false, message: "Analysis failed: " + e.message };
    }
}
