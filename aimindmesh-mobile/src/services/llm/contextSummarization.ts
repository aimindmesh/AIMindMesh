import { Message } from '../../types';
import { logger } from '../logger';
import { getMessagesToSummarize } from './contextMonitor';

/**
 * Creates a specific prompt for context summarization. An earlier summary (first message of
 * the model history) is folded into the new one, so nothing it covered is forgotten.
 */
function createSummarizationPrompt(earlierSummaries: Message[], messages: Message[]): string {
    let conversationText = 'Previous conversation:\n\n';

    for (const summary of earlierSummaries) {
        conversationText += `Earlier summary: ${summary.text.replace(/^\[Context Summary\][^\n]*\n*/, '')}\n\n`;
    }
    for (const msg of messages) {
        const role = msg.role === 'model' ? 'Assistant' : 'User';
        conversationText += `${role}: ${msg.text}\n\n`;
    }

    conversationText += `\nPlease provide a concise summary of the key points, decisions, and context from this conversation. Focus on:
- Important facts and information exchanged
- Decisions made or conclusions reached
- Ongoing topics or unresolved questions
- Any specific requests or commitments

Keep the summary brief but comprehensive (2-4 paragraphs maximum).`;

    return conversationText;
}

/**
 * Summarizes the older part of the model history (see contextSummaryStore: the conversation
 * itself is never changed). Returns the summary and the id of the last message it covers,
 * or null when there is nothing to summarize or the model returned nothing.
 *
 * @param messages Model history (already with the thread's current summary applied)
 * @param threshold Summarization threshold
 * @param generate Runs the prompt (a background task: it may return null when the model is busy)
 */
export async function summarizeForModel(
    messages: Message[],
    threshold: number,
    generate: (prompt: string) => Promise<string | null>
): Promise<{ summary: string; coversUpToId: string; summarizedCount: number } | null> {
    try {
        logger.log('info', '[ContextSummarization] Starting summarization', {
            totalMessages: messages.length,
            threshold: Math.round(threshold * 100)
        });

        // Identify which messages to summarize (summary messages are never in toSummarize)
        const { toSummarize, toKeep } = getMessagesToSummarize(messages, threshold);
        if (toSummarize.length === 0) {
            logger.log('warn', '[ContextSummarization] No messages to summarize');
            return null;
        }
        const keptIds = new Set(toKeep.map(m => m.id));
        const earlierSummaries = messages.filter(m => isSummaryMessage(m) && !keptIds.has(m.id));

        const summary = await generate(createSummarizationPrompt(earlierSummaries, toSummarize));
        if (!summary || summary.trim().length === 0) {
            logger.log('error', '[ContextSummarization] Failed to generate summary');
            return null;
        }

        logger.log('info', '[ContextSummarization] Summarization complete', {
            summarizedCount: toSummarize.length,
            keptCount: toKeep.length
        });
        return { summary: summary.trim(), coversUpToId: toSummarize[toSummarize.length - 1].id, summarizedCount: toSummarize.length };
    } catch (error) {
        logger.log('error', '[ContextSummarization] Error during summarization', error);
        return null;
    }
}

/**
 * Checks if a message is a summary
 */
export function isSummaryMessage(message: Message): boolean {
    return message.isSummary === true || message.text.startsWith('[Context Summary]');
}
