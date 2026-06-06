
import { LLMConfig } from '../../types';
import { generateTextResponseStream } from '../llm/llmService';
import { saveMemoryToDb, deleteMemoryFromDb, getAllSemanticMemories } from './memoryDatabase';
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

export class MemorySummarizer {
    private llmConfig: LLMConfig;
    private apiKey?: string;

    constructor(llmConfig: LLMConfig, apiKey?: string) {
        this.llmConfig = llmConfig;
        this.apiKey = apiKey;
    }

    async summarizeMemories(countToSummarize: number = 20): Promise<{ success: boolean; message: string }> {
        try {
            logger.log('info', '[MemorySummarizer] Starting summarization...');

            // 1. Get all semantic memories
            // We'll summarize the OLDEST memories first to keep the "long term" memory compact
            const allMemories = await getAllSemanticMemories();

            // Filter out memories that are already summaries (if we had a flag, but for now we basically rely on content length or metadata.
            // For now, let's just take the oldest N memories.
            // Sort by timestamp asc
            allMemories.sort((a, b) => a.timestamp - b.timestamp);

            const memoriesToSummarize = allMemories.slice(0, countToSummarize);

            if (memoriesToSummarize.length < 5) {
                return { success: false, message: 'Not enough memories to summarize (min 5).' };
            }

            // 2. Prepare content for LLM
            const memoryContent = memoriesToSummarize.map(m => `- [${new Date(m.timestamp).toLocaleDateString()}] ${m.content}`).join('\n');
            const prompt = SUMMARIZATION_PROMPT.replace('{{MEMORIES}}', memoryContent);

            // 3. Generate Summary
            // We use a "cheap" or "fast" model if possible, but here we just use the configured one
            const stream = await generateTextResponseStream(
                [{ role: 'user', id: 'system', text: prompt, timestamp: new Date() }],
                { name: 'System', description: 'System', systemPrompt: '', traits: [] }, // Dummy personality
                this.llmConfig,
                [] as any[], // No memories needed for summarization
                this.apiKey,
                undefined // No abort signal necessary for now
            );

            let summary = '';
            for await (const chunk of stream) {
                if (typeof chunk === 'string') {
                    summary += chunk;
                } else if (chunk.type === 'text') {
                    summary += chunk.content;
                }
            }

            if (!summary || summary.trim().length === 0) {
                throw new Error('Failed to generate summary from LLM');
            }

            logger.log('info', '[MemorySummarizer] Generated summary:', summary);

            // 4. Save new summary memory
            const newId = `summary_${Date.now()}`;
            // We need an embedding for the new summary
            const { TextEmbedding } = await import('text-embedding-capacitor');
            const result = await TextEmbedding.generateEmbedding({ text: summary });
            const embedding = new Float32Array(result.embedding);

            await saveMemoryToDb(
                newId,
                'system_summary', // session_id
                'system',        // role
                `[MEMORY SUMMARY] ${summary}`, // Content
                embedding
            );

            // 5. Delete old memories
            logger.log('info', `[MemorySummarizer] Deleting ${memoriesToSummarize.length} old memories...`);
            for (const mem of memoriesToSummarize) {
                await deleteMemoryFromDb(mem.id);
            }

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

            // 1. Get all memories with embeddings
            const { getAllSemanticMemoriesWithEmbeddings } = await import('./memoryDatabase');
            const memories = await getAllSemanticMemoriesWithEmbeddings();

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

                    const similarity = this.computeCosineSimilarity(memories[i].embedding, memories[j].embedding);
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

                // Generate
                const stream = await generateTextResponseStream(
                    [{ role: 'user', id: 'system', text: prompt, timestamp: new Date() }],
                    { name: 'System', description: 'System', systemPrompt: '', traits: [] },
                    this.llmConfig,
                    [] as any[],
                    this.apiKey
                );

                let consolidatedText = '';
                for await (const chunk of stream) {
                    if (typeof chunk === 'string') consolidatedText += chunk;
                    else if (chunk.type === 'text') consolidatedText += chunk.content;
                }

                consolidatedText = consolidatedText.replace(/^Consolidated Memory:\s*/i, '').trim();

                if (consolidatedText) {
                    // Save new
                    const newId = `consolidated_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
                    const { TextEmbedding } = await import('text-embedding-capacitor');
                    const result = await TextEmbedding.generateEmbedding({ text: consolidatedText });
                    const embedding = new Float32Array(result.embedding);

                    await saveMemoryToDb(
                        newId,
                        cluster[0].sessionId,
                        cluster[0].role,
                        consolidatedText,
                        embedding
                    );

                    // Delete old
                    for (const mem of cluster) {
                        await deleteMemoryFromDb(mem.id);
                    }

                    totalConsolidated += cluster.length;
                    logger.log('info', `[MemorySummarizer] Consolidated ${cluster.length} memories into: "${consolidatedText}"`);
                }
            }

            return {
                success: true,
                message: `Consolidated ${totalConsolidated} memories into ${clusters.length} new entries.`,
                consolidatedCount: totalConsolidated
            };

        } catch (error: any) {
            logger.log('error', '[MemorySummarizer] Consolidation failed', error);
            return { success: false, message: error.message, consolidatedCount: 0 };
        }
    }

    private computeCosineSimilarity(a: Float32Array, b: Float32Array): number {
        if (a.length !== b.length) return 0;
        let dot = 0, normA = 0, normB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        return (normA === 0 || normB === 0) ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
    }
}
