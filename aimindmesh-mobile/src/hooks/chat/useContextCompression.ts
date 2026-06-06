import { Message } from '../../types';
import { logger } from '../../services/logger';
import { estimateTokens } from '../../services/llm/context/unifiedContextManager';
import { getMemoryPressure, MemoryPressureLevel } from '../../services/native/memoryMonitor';

/**
 * Hook/Utility to compress conversation history when approaching context limits.
 */
export const useContextCompression = () => {
    /**
     * Compress conversation history when approaching context limits.
     * Keeps system message + last N messages, summarizes middle messages.
     * Aggressive compression for small models.
     */
    const compressHistoryIfNeeded = (history: Message[], defaultMaxTokens: number = 1500): Message[] => {
        // Adjust max tokens based on native memory pressure
        let maxTokens = defaultMaxTokens;
        const pressure = getMemoryPressure();
        if (pressure === MemoryPressureLevel.CRITICAL) {
            maxTokens = Math.floor(defaultMaxTokens * 0.4); // Very aggressive
            logger.log('warn', `[ContextCompression] CRITICAL memory pressure! Lowering maxTokens to ${maxTokens}`);
        } else if (pressure === MemoryPressureLevel.MODERATE) {
            maxTokens = Math.floor(defaultMaxTokens * 0.7); // Moderate
            logger.log('warn', `[ContextCompression] MODERATE memory pressure! Lowering maxTokens to ${maxTokens}`);
        }

        // Calculate tokens instead of characters
        const totalTokens = history.reduce((sum, m) => sum + estimateTokens(m.text || ''), 0);

        if (totalTokens <= maxTokens) {
            return history; // No compression needed
        }

        logger.log('debug', `[ContextCompression] Compressing history: ${totalTokens} tokens -> limit ${maxTokens}`);

        // Keep only 2 recent messages (most recent tool result + context)
        const keepRecent = 2;

        if (history.length <= keepRecent + 1) {
            // Too few messages to compress meaningfully
            return history;
        }

        // Build summary of old messages
        const oldMessages = history.slice(0, -keepRecent);
        const recentMessages = history.slice(-keepRecent);

        // CRITICAL: Find the most recent user message with attachments (images/audio)
        // and ensure it is preserved - attachments must not be lost during compression
        const messageWithAttachments = [...oldMessages].reverse().find(
            m => m.role === 'user' && ((m.images && m.images.length > 0) || (m.audio && m.audio.length > 0))
        );

        // Create a condensed summary of old messages
        const summaryParts: string[] = [];
        for (const msg of oldMessages) {
            // Skip the message with attachments - we'll add it separately
            if (messageWithAttachments && msg.id === messageWithAttachments.id) continue;
            if (msg.role === 'user') {
                const shortText = msg.text.substring(0, 100);
                summaryParts.push(`User asked: ${shortText}${msg.text.length > 100 ? '...' : ''}`);
            } else if (msg.role === 'model') {
                // Check if it was a tool call
                if (msg.text.includes('<tool>') || msg.text.includes('Tool ')) {
                    summaryParts.push('Assistant used tools to gather information.');
                } else {
                    summaryParts.push('Assistant responded.');
                }
            }
        }

        const summaryMessage: Message = {
            id: 'summary_' + Date.now(),
            role: 'user',
            text: `[CONTEXT SUMMARY - Previous conversation compressed]\n${summaryParts.join('\n')}`,
            timestamp: new Date()
        };

        // Include the message with attachments AFTER the summary so the model sees it
        const compressedHistory = messageWithAttachments
            ? [summaryMessage, messageWithAttachments, ...recentMessages]
            : [summaryMessage, ...recentMessages];
        const newTokens = compressedHistory.reduce((sum, m) => sum + estimateTokens(m.text || ''), 0);
        logger.log('debug', `[ContextCompression] Compressed: ${history.length} messages -> ${compressedHistory.length}, ${totalTokens} tokens -> ${newTokens} tokens`);

        return compressedHistory;
    };

    return { compressHistoryIfNeeded };
};

