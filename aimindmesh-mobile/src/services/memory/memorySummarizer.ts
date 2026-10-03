
import { LLMConfig } from '../../types';
import { generateTextResponseStream } from '../llm/llmService';
import { getAllSemanticMemoriesWithEmbeddings, getOldestMemoriesForSummary, replaceMemoriesAtomically } from './memoryDatabase';
import { cosineSimilarity } from './embeddingCodec';
import { memoryTaskConfig } from './memoryLlmConfig';
import { embedText, ensureEmbeddingModel, ensureEmbeddingModelFromSettings, getActiveEmbeddingModel, getEmbeddingLoadError } from '../model/embedding/embeddingRuntime';
import { logger } from '../logger';

const SUMMARIZATION_PROMPT = `
You are an expert memory organizer. Your task is to consolidate a list of individual memories into a single, concise, and dense summary.
Preserve all key facts, preferences, relationships, and important details.
Discard filler words, redundant information, and timestamps.
The summary should be written in the first person perspective of the user if the memories are about the user (e.g. "I like coffee"), or third person if about others.
Do not use bullet points. Write a coherent paragraph.

Here are the memories to summarize:
{{MEMORIES}}

Summary:
`;

/** Consolidation compares every pair: only the most recent rows are clustered */
const MAX_CONSOLIDATION_ROWS = 500;

export class MemorySummarizer {
    private llmConfig: LLMConfig;
    private apiKey?: string;

    constructor(llmConfig: LLMConfig, apiKey?: string) {
        this.llmConfig = llmConfig;
        this.apiKey = apiKey;
    }

    /** Text of an internal LLM task: no injected memories, tools or thinking in the output */
    private async generate(prompt: string): Promise<string> {
        let text = '';
        for await (const chunk of generateTextResponseStream(
            [{ role: 'user', id: 'system', text: prompt, timestamp: new Date() }],
            { name: 'System', description: 'System', systemPrompt: '', traits: [] }, // Dummy personality
            memoryTaskConfig(this.llmConfig),
            [] as any[], // No memories needed for summarization
            this.apiKey
        )) {
            if (typeof chunk === 'string') text += chunk;
            else if (chunk.type === 'text') text += chunk.content;
        }
        return text.trim();
    }

    /** Embedding model the new rows are stored with (the one selected in the settings). */
    private async ensureModel(): Promise<string> {
        const loaded = this.llmConfig.embeddingModelId
            ? await ensureEmbeddingModel(this.llmConfig.embeddingModelId)
            : await ensureEmbeddingModelFromSettings();
        const model = getActiveEmbeddingModel();
        if (!loaded || !model) {
            throw new Error(`Embedding model not available${getEmbeddingLoadError() ? `: ${getEmbeddingLoadError()}` : ''}`);
        }
        return model.key;
    }

    async summarizeMemories(countToSummarize: number = 20): Promise<{ success: boolean; message: string }> {
        try {
            logger.log('info', '[MemorySummarizer] Starting summarization...');

            // The OLDEST memories (summaries excluded) are compressed first, to keep the
            // "long term" memory compact without re-summarizing summaries every run
            const memoriesToSummarize = await getOldestMemoriesForSummary(countToSummarize);

            if (memoriesToSummarize.length < 5) {
                return { success: false, message: 'Not enough memories to summarize (min 5).' };
            }
            const modelKey = await this.ensureModel();

            // 2. Prepare content for LLM
            const memoryContent = memoriesToSummarize.map(m => `- [${new Date(m.timestamp).toLocaleDateString()}] ${m.content}`).join('\n');
            const summary = await this.generate(SUMMARIZATION_PROMPT.replace('{{MEMORIES}}', memoryContent));

            if (!summary) {
                throw new Error('Failed to generate summary from LLM');
            }

            logger.log('info', '[MemorySummarizer] Generated summary:', summary);

            // 4. Save the summary and delete the old memories in one transaction
            const content = `[MEMORY SUMMARY] ${summary}`;
            const { vector, key } = await embedText(content, 'passage');
            if (key !== modelKey) throw new Error('Embedding model changed during summarization');
            await replaceMemoriesAtomically(
                { id: `summary_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, sessionId: 'system_summary', role: 'system', content, embedding: vector, modelKey: key },
                memoriesToSummarize.map(m => m.id)
            );
            logger.log('info', `[MemorySummarizer] Replaced ${memoriesToSummarize.length} old memories with a summary`);

            return {
                success: true,
                message: `Successfully compressed ${memoriesToSummarize.length} memories into one summary.`
            };

        } catch (error: any) {
            logger.log('error', '[MemorySummarizer] Failed to summarize', error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Consolidate memories that are semantically similar (e.g. > 0.85)
     * This groups them and asks LLM to merge them.
     */
    async consolidateRedundantMemories(similarityThreshold: number = 0.80): Promise<{ success: boolean; message: string; consolidatedCount: number }> {
        try {
            logger.log('info', `[MemorySummarizer] Starting consolidation (threshold: ${similarityThreshold})...`);

            // 1. Recent memories with embeddings of the active model (others are not comparable)
            const modelKey = await this.ensureModel();
            const memories = await getAllSemanticMemoriesWithEmbeddings(modelKey, MAX_CONSOLIDATION_ROWS);

            if (memories.length < 2) {
                return { success: true, message: 'Not enough memories to consolidate.', consolidatedCount: 0 };
            }

            logger.log('debug', `[MemorySummarizer] Analyzing ${memories.length} memories for clusters...`);

            // 2. Greedy Clustering
            // We want to find groups of memories that are very similar
            const clusters: Array<typeof memories> = [];
            const processed = new Set<string>();

            for (let i = 0; i < memories.length; i++) {
                if (processed.has(memories[i].id)) continue;

                const currentCluster = [memories[i]];
                processed.add(memories[i].id);

                for (let j = i + 1; j < memories.length; j++) {
                    if (processed.has(memories[j].id)) continue;

                    const similarity = cosineSimilarity(memories[i].embedding, memories[j].embedding);
                    if (similarity >= similarityThreshold) {
                        currentCluster.push(memories[j]);
                        processed.add(memories[j].id);
                    }

                    // Yield to event loop periodically to prevent ANR during high memory counts
                    if (j % 50 === 0) {
                        await new Promise(resolve => setTimeout(resolve, 0));
                    }
                }

                if (currentCluster.length > 1) {
                    clusters.push(currentCluster);
                }
            }

            logger.log('info', `[MemorySummarizer] Found ${clusters.length} clusters to consolidate.`);

            // 3. Process clusters
            let totalConsolidated = 0;
            let merged = 0;

            for (const cluster of clusters) {
                // Generate prompt
                const memoryContent = cluster.map(m => `- ${m.content}`).join('\n');
                const prompt = `
You are a memory efficient assistant.
Combine the following related memories into a single, concise memory statement.
If they are exact duplicates, just pick one.
If they conflict, prefer the most recent one (but here they are just a list).
Do not loose important details.

Memories:
${memoryContent}

Consolidated Memory:
`;

                const consolidatedText = (await this.generate(prompt)).replace(/^Consolidated Memory:\s*/i, '').trim();

                if (consolidatedText) {
                    const { vector, key } = await embedText(consolidatedText, 'passage');
                    if (key !== modelKey) throw new Error('Embedding model changed during consolidation');
                    // Facts and summaries stay long-lived once merged; chat turns keep their role
                    const longLived = cluster.some(m => m.role === 'extracted' || m.role === 'system');

                    // Save the merged memory and delete the cluster in one transaction
                    await replaceMemoriesAtomically({
                        id: `consolidated_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                        sessionId: cluster[0].sessionId,
                        role: longLived ? 'extracted' : cluster[0].role,
                        content: consolidatedText,
                        embedding: vector,
                        modelKey: key,
                    }, cluster.map(m => m.id));

                    totalConsolidated += cluster.length;
                    merged++;
                    logger.log('info', `[MemorySummarizer] Consolidated ${cluster.length} memories into: "${consolidatedText}"`);
                }
            }

            return {
                success: true,
                message: `Consolidated ${totalConsolidated} memories into ${merged} new entries.`,
                consolidatedCount: totalConsolidated
            };

        } catch (error: any) {
            logger.log('error', '[MemorySummarizer] Consolidation failed', error);
            return { success: false, message: error.message, consolidatedCount: 0 };
        }
    }
}
