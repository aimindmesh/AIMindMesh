
import { Message, Personality, LLMConfig } from '../../types';
import { generateTextResponseStream } from '../llm/llmService';
import { buildMemoryExtractionPrompt } from '../llm/promptBuilder';
import { logger } from '../logger';
import { memoryTaskConfig } from './memoryLlmConfig';

export class MemoryExtractionService {
    private llmConfig: LLMConfig;
    private apiKey: string;

    constructor(llmConfig: LLMConfig, apiKey: string) {
        this.llmConfig = llmConfig;
        this.apiKey = apiKey;
    }

    /**
     * Analyzes recent conversation history to extract potential memories.
     * This is designed to be run in the background.
     */
    async extractAndSaveMemory(
        history: Message[],
        personality: Personality,
        addMemoryCallback: (content: string, category: string) => void | Promise<void>
    ): Promise<boolean> {
        // Only extract if we have enough context (at least 2 messages)
        if (history.length < 2) return false;

        // Use the last few messages for extraction (up to 6)
        // We want to capture the immediate context of the turn
        const recentHistory = history.slice(-6);

        // Sanity check: Ensure at least one user message is in the recent history
        if (!recentHistory.some(m => m.role === 'user')) return false;

        const prompt = buildMemoryExtractionPrompt(recentHistory, personality);

        // Use a "system" personality for the extractor to avoid contamination
        const extractorPersona: Personality = {
            name: 'MemoryExtractor',
            description: 'System module',
            systemPrompt: 'You are a precise JSON generator.',
            traits: []
        };

        // No tools, no thinking (we want raw JSON) and no injected memories: a retrieved memory
        // in the prompt would come back as a "new" fact
        const extractionConfig: LLMConfig = memoryTaskConfig(this.llmConfig);

        // logger.log('debug', '[MemoryExtraction] Config:', JSON.stringify(extractionConfig));

        logger.log('info', '[MemoryExtraction] Starting extraction...');

        try {
            let fullResponse = '';

            // Use the streaming extraction but buffer it
            for await (const chunk of generateTextResponseStream(
                [{ role: 'user', text: prompt, id: 'sys_memory_req', timestamp: new Date() }],
                extractorPersona,
                extractionConfig,
                [],
                this.apiKey
            )) {
                if (typeof chunk === 'string') fullResponse += chunk;
                else if (chunk.type === 'text') fullResponse += chunk.content;
            }

            fullResponse = fullResponse.trim();

            // Attempt to parse JSON
            // Handle potential code block wrapping
            const jsonMatch = fullResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const jsonStr = jsonMatch[0];
                try {
                    const result = JSON.parse(jsonStr);

                    if (typeof result.memory === 'string' && result.memory.trim() && result.memory !== 'null' && result.memory !== 'NONE') {
                        logger.log('info', `[MemoryExtraction] Found memory: "${result.memory}" [${result.category}]`);
                        // Awaited so a failed save is reported here instead of as an unhandled rejection
                        await addMemoryCallback(result.memory.trim(), typeof result.category === 'string' && result.category.trim() ? result.category.trim() : 'other');
                        return true;
                    } else {
                        logger.log('debug', '[MemoryExtraction] No relevant memory found.');
                    }
                } catch (e) {
                    logger.log('warn', '[MemoryExtraction] Failed to parse JSON response', fullResponse);
                }
            } else {
                logger.log('warn', '[MemoryExtraction] No JSON found in response', fullResponse);
            }

        } catch (error) {
            logger.log('error', '[MemoryExtraction] Error during memory extraction', error);
        }

        return false;
    }
}
