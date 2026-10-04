import { GoogleGenAI } from "@google/genai";
import { Message, Personality, LLMConfig } from "../../../types";
import { logger } from "../../logger";
import { buildPromptContext, systemPromptWithContext } from "../promptContext";
import { getGeminiFunctionDeclarations } from "../../toolDefinitions";
import { StreamChunk } from "../llmService";
import { toGeminiRole } from "../roles";

// Fallback list of known stable Gemini models (May 2026)
export const GEMINI_FALLBACK_MODELS = [
    'gemini-3.5-flash',
    'gemini-3.1-pro',
    'gemini-3.1-flash',
    'gemini-3.1-flash-lite',
    'gemini-3.1-flash-live',
];

/**
 * Fetch the list of Gemini models available for the given API key.
 * Filters only models that support generateContent.
 * Returns GEMINI_FALLBACK_MODELS on error.
 */
export async function fetchGeminiModels(apiKey: string): Promise<string[]> {
    try {
        const client = getAiClient(apiKey);
        const response = await client.models.list();
        const models: string[] = [];
        for await (const model of response) {
            const name = (model.name || '').replace(/^models\//, '');
            const methods: string[] = (model as any).supportedGenerationMethods || [];
            if (name && methods.includes('generateContent')) {
                models.push(name);
            }
        }
        if (models.length > 0) {
            logger.log('info', `[GeminiProvider] Fetched ${models.length} models`);
            return models;
        }
        logger.log('warn', '[GeminiProvider] No models returned, using fallback list');
        return GEMINI_FALLBACK_MODELS;
    } catch (error) {
        logger.log('error', '[GeminiProvider] Failed to fetch model list, using fallback', error);
        return GEMINI_FALLBACK_MODELS;
    }
}

// Helper to check if tool calling is enabled
const isToolCallingEnabled = (llmConfig: LLMConfig): boolean => {
    return llmConfig.enableToolCalling === true;
};

// Singleton instance management
let ai: GoogleGenAI | null = null;
let lastApiKey: string | null = null;

export const getAiClient = (apiKey?: string): GoogleGenAI => {
    const key = apiKey || process.env.API_KEY;
    if (!key) {
        const errorMessage = "Gemini API key is not configured. Please provide it in settings or environment variables.";
        logger.log('error', errorMessage);
        throw new Error(errorMessage);
    }

    if (!ai || key !== lastApiKey) {
        logger.log('info', 'Initializing Gemini AI client with new key.');
        ai = new GoogleGenAI({ apiKey: key });
        lastApiKey = key;
    }
    return ai;
};

// Helper function to build message parts including images for Gemini API
import { FileSystemAdapter as Filesystem } from '../../../utils/fileSystemAdapter';

// Helper function to build message parts including images and audio for Gemini API
export async function buildMessageParts(message: Message): Promise<Array<{ text: string } | { inlineData: { data: string; mimeType: string } }>> {
    const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [];

    // Add text part (an empty text part is rejected: image-only messages send just the image)
    if (message.text?.trim()) parts.push({ text: message.text });

    // Add image parts if present
    if (message.images && message.images.length > 0) {
        for (const img of message.images) {
            let base64 = img.base64;

            // If base64 is missing but path is present, read the file
            if (!base64 && img.path) {
                try {
                    const result = await Filesystem.readFile({ path: img.path });
                    // Filesystem usually returns pure base64 in data
                    base64 = result.data as string;
                } catch (e) {
                    logger.log('error', `Gemini: Failed to read image file at ${img.path}`, e);
                }
            }

            if (base64) {
                parts.push({
                    inlineData: {
                        data: base64,
                        mimeType: img.mimeType
                    }
                });
            }
        }
    }

    // Add audio parts if present
    if (message.audio && message.audio.length > 0) {
        for (const aud of message.audio) {
            let base64 = '';

            // Handle data URI format (for meeting mode)
            if (aud.path.startsWith('data:')) {
                // Extract base64 from data URI
                const match = aud.path.match(/^data:[^;]+;base64,(.+)$/);
                if (match) {
                    base64 = match[1];
                }
            } else if (aud.path) {
                // Read from file path
                try {
                    const result = await Filesystem.readFile({ path: aud.path });
                    base64 = result.data as string;
                } catch (e) {
                    logger.log('error', `Gemini: Failed to read audio file at ${aud.path}`, e);
                }
            }

            if (base64) {
                parts.push({
                    inlineData: {
                        data: base64,
                        mimeType: aud.mimeType || 'audio/webm'
                    }
                });
                logger.log('debug', `Gemini: Added audio part (${base64.length} chars)`);
            }
        }
    }

    if (parts.length === 0) parts.push({ text: ' ' });
    return parts;
}

/**
 * Generate Gemini stream WITH function calling, thinking, and search support
 * Yields StreamChunk objects that can be text, thinking, sources, or function calls
 */
export async function* generateGeminiStreamWithTools(
    history: Message[],
    personality: Personality,
    llmConfig: LLMConfig,
    apiKey?: string,
    signal?: AbortSignal,
    maxResponseLength?: number
): AsyncGenerator<StreamChunk> {
    const userMessage = history[history.length - 1];
    // A hidden 'system' trigger (autonomous call greeting) is sent as a user turn
    if (!userMessage || userMessage.role === 'model') throw new Error("Last message must be from user.");

    const aiClient = getAiClient(apiKey);
    const llmParams = personality.llmParams || {};
    const geminiModel = llmConfig.geminiModel || 'gemini-3.5-flash';

    // Persona, what is known about the user, related memories and workspace documents
    const promptContext = await buildPromptContext({ personality, llmConfig, history });

    // Build history for the API with potential image support
    const historyForApi = await Promise.all(history.slice(0, -1).map(async m => ({
        role: toGeminiRole(m.role),
        parts: await buildMessageParts(m)
    })));

    // Build tools array
    const tools: any[] = [];
    if (isToolCallingEnabled(llmConfig)) {
        tools.push({ functionDeclarations: getGeminiFunctionDeclarations(llmConfig.toolRules) });
    }
    if (llmConfig.enableSearch) {
        tools.push({ googleSearch: {} });
    }

    // Build thinking config
    const thinkingConfig = llmConfig.enableThinking ? {
        includeThoughts: true,
        ...(llmConfig.thinkingBudget !== undefined && llmConfig.thinkingBudget > 0
            ? { thinkingBudget: llmConfig.thinkingBudget }
            : {})
    } : undefined;

    const systemPrompt = systemPromptWithContext(promptContext);

    logger.log('info', 'Generating Gemini stream', {
        model: geminiModel,
        hasImages: !!userMessage.images?.length,
        tools: tools.length,
        thinking: !!thinkingConfig,
        search: !!llmConfig.enableSearch,
        turnContext: promptContext.turnContext.length
    });

    const userParts = await buildMessageParts(userMessage);

    // Use non-streaming generateContent to get complete response with metadata
    const response = await aiClient.models.generateContent({
        model: geminiModel,
        contents: [
            ...historyForApi,
            { role: 'user', parts: userParts }
        ],
        config: {
            abortSignal: signal, // Stop cancels the request instead of waiting for the full answer
            systemInstruction: systemPrompt,
            temperature: llmParams.temperature ?? 0.7,
            topP: llmParams.topP ?? 0.9,
            maxOutputTokens: llmParams.maxTokens ?? (maxResponseLength || 1000),
            ...(tools.length > 0 ? { tools } : {}),
            ...(thinkingConfig ? { thinkingConfig } : {})
        }
    });

    // Check for abort
    if (signal?.aborted) {
        throw new DOMException('Generation aborted by user', 'AbortError');
    }

    // Process response parts for thinking summaries
    const candidate = response.candidates?.[0];
    if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
            if ((part as any).thought && (part as any).text) {
                yield { type: 'thinking', content: (part as any).text };
            }
        }
    }

    // Check if there are function calls
    const functionCalls = response.functionCalls;
    if (functionCalls && functionCalls.length > 0) {
        for (const fc of functionCalls) {
            logger.log('info', `Gemini requested function call: ${fc.name}`, fc.args);
            yield {
                type: 'function_call',
                call: {
                    name: fc.name!,
                    args: fc.args as Record<string, unknown>
                }
            };
        }
    }

    // Process grounding metadata for search sources
    const groundingMetadata = (response as any).candidates?.[0]?.groundingMetadata;
    if (groundingMetadata?.groundingChunks) {
        const sources = groundingMetadata.groundingChunks
            .filter((chunk: any) => chunk.web)
            .map((chunk: any) => ({
                title: chunk.web.title || 'Source',
                uri: chunk.web.uri
            }));
        if (sources.length > 0) {
            yield { type: 'sources', sources };
        }
    }

    // Yield text response (filter out thought parts)
    const textParts = candidate?.content?.parts?.filter((part: any) => !part.thought && part.text);
    const text = textParts?.map((part: any) => part.text).join('') || response.text;
    if (text) {
        yield { type: 'text', content: text };
    }
}
