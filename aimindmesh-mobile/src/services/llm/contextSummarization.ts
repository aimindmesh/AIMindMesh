import { Message, LLMConfig } from '../../types';
import { logger } from '../logger';
import { generateMemorySummary } from './llmService';
import { getMessagesToSummarize } from './contextMonitor';

/**
 * Creates a specific prompt for context summarization
 */
function createSummarizationPrompt(messages: Message[]): string {
    let conversationText = 'Previous conversation:\n\n';

    for (const msg of messages) {
        const role = msg.role === 'user' ? 'User' : 'Assistant';
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
 * Creates a special 'system' message containing the summary
 */
function createSummaryMessage(summary: string): Message {
    return {
        id: `summary-${Date.now()}`,
        role: 'system',
        text: `[Context Summary] Previous conversation covered:\n\n${summary}`,
        timestamp: new Date(),
        isSummary: true
    };
}

/**
 * Summarizes a portion of the conversation and returns a new array of messages
 * 
 * @param messages Complete array of messages
 * @param llmConfig LLM Configuration
 * @param threshold Summarization threshold
 * @param apiKey Optional API key for cloud providers
 * @returns New array with summary + recent messages
 */
export async function summarizeConversation(
    messages: Message[],
    llmConfig: LLMConfig,
    threshold: number,
    apiKey?: string
): Promise<Message[]> {
    try {
        logger.log('info', '[ContextSummarization] Starting summarization', {
            totalMessages: messages.length,
            threshold: Math.round(threshold * 100)
        });

        // Identify which messages to summarize
        const { toSummarize, toKeep } = getMessagesToSummarize(messages, threshold);

        if (toSummarize.length === 0) {
            logger.log('warn', '[ContextSummarization] No messages to summarize');
            return messages;
        }

        // Create the summarization prompt
        const prompt = createSummarizationPrompt(toSummarize);

        // Generate summary using existing function
        const summary = await generateMemorySummary(prompt, llmConfig, apiKey);

        if (!summary || summary.trim().length === 0) {
            logger.log('error', '[ContextSummarization] Failed to generate summary');
            return messages; // Fallback: return original messages
        }

        // Create summary message
        const summaryMessage = createSummaryMessage(summary);

        // Build new array: [summary, ...recent messages]
        const newMessages = [summaryMessage, ...toKeep];

        logger.log('info', '[ContextSummarization] Summarization complete', {
            originalCount: messages.length,
            newCount: newMessages.length,
            summarizedCount: toSummarize.length,
            savedTokens: Math.round((messages.length - newMessages.length) * 50) // Estimate
        });

        return newMessages;

    } catch (error) {
        logger.log('error', '[ContextSummarization] Error during summarization', error);
        return messages; // Fallback: return original messages
    }
}

/**
 * Checks if a message is a summary
 */
export function isSummaryMessage(message: Message): boolean {
    return message.isSummary === true || message.text.startsWith('[Context Summary]');
}
