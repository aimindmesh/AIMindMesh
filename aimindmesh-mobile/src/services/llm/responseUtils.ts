/**
 * Response Utilities
 * 
 * Utilities for intelligent response length management.
 * Ensures AI responses end with complete sentences and provides
 * style-based length hints.
 */

import { ResponseStyle } from '../../types';

/**
 * Ensures the given text ends with a complete sentence.
 * If the text appears to be cut off mid-sentence, it will be truncated
 * to the last complete sentence.
 * 
 * @param text - The response text from the LLM
 * @returns Text ending at a natural sentence boundary
 */
export function ensureCompleteSentence(text: string): string {
    if (!text || text.trim().length === 0) {
        return text;
    }

    const trimmed = text.trim();

    // Check if text already ends with a sentence terminator followed by optional whitespace
    const sentenceEnders = ['.', '!', '?', '…', '。', '？', '！'];
    const lastChar = trimmed.slice(-1);

    // If ends with sentence ender, check it's not a list number
    if (sentenceEnders.includes(lastChar)) {
        // Check if it's a numbered list marker (e.g., "10." at end)
        const lastFewChars = trimmed.slice(-5);
        if (!/^\d+\.$/.test(lastFewChars.trim())) {
            return trimmed;
        }
        // It's a list number, we need to find the real last sentence
    }

    // Also accept common ending patterns
    if (trimmed.endsWith('...)') || trimmed.endsWith('...') ||
        trimmed.endsWith('."') || trimmed.endsWith('!"') ||
        trimmed.endsWith('?"') || trimmed.endsWith('.\'') ||
        trimmed.endsWith('?)') || trimmed.endsWith('!)') ||
        trimmed.endsWith(')') || // Markdown links
        trimmed.endsWith('```') || // Code blocks
        trimmed.endsWith('`') || // Inline code
        trimmed.endsWith('*)') || trimmed.endsWith('*')  // Markdown bold endings
    ) {
        return trimmed;
    }

    // Find the last REAL sentence terminator (not list markers)
    let lastSentenceEnd = -1;

    for (let i = trimmed.length - 1; i >= 0; i--) {
        const char = trimmed[i];

        if (sentenceEnders.includes(char) && char === '.') {
            // Get context around this period
            const prevChars = trimmed.substring(Math.max(0, i - 4), i);
            const nextChar = i < trimmed.length - 1 ? trimmed[i + 1] : '';
            const afterDot = trimmed.substring(i + 1).trimStart();

            // Skip numbered list markers: "1." "10." etc followed by space, newline, or **
            if (/\d$/.test(prevChars) && (nextChar === ' ' || nextChar === '\n' || afterDot.startsWith('**'))) {
                // Check if the character before the digits is newline, space, or start
                const beforeNumber = i > 1 ? trimmed[i - prevChars.replace(/\D/g, '').length - 1] : '';
                if (beforeNumber === '' || beforeNumber === '\n' || beforeNumber === ' ') {
                    continue; // This is a list marker, skip it
                }
            }

            // Skip decimal numbers (digit before and after the period)
            if (/\d$/.test(prevChars) && /^\d/.test(nextChar)) {
                continue;
            }

            // Skip common abbreviations
            if (/[A-Z]$/.test(prevChars.slice(-1)) &&
                (nextChar === '' || nextChar === ' ' || nextChar === '\n')) {
                if (afterDot.length > 0 && /^[a-z]/.test(afterDot)) {
                    continue;
                }
            }

            lastSentenceEnd = i;
            break;
        } else if (sentenceEnders.includes(char)) {
            // For !, ?, etc. - just accept them as sentence ends
            lastSentenceEnd = i;
            break;
        }
    }

    // If we found a sentence end, truncate there
    if (lastSentenceEnd > 0 && lastSentenceEnd > trimmed.length * 0.3) {
        return trimmed.substring(0, lastSentenceEnd + 1).trim();
    }

    // If no good truncation point, return original (better than returning nothing)
    return trimmed;
}

/**
 * Returns the suggested max tokens based on response style.
 * Includes a buffer for post-processing truncation.
 */
export function getMaxTokensForStyle(style: ResponseStyle): number {
    switch (style) {
        case 'concise':
            return 512;  // Short responses (increased for thinking)
        case 'normal':
            return 1500;  // Medium responses (increased for thinking)
        case 'detailed':
            return 4000; // Long responses (increased for thinking)
        default:
            return 1500;
    }
}

/**
 * Generates a hint to include in the system prompt based on the response style.
 * This guides the model to produce appropriately-sized responses.
 */
export function getResponseLengthHint(style: ResponseStyle): string {
    switch (style) {
        case 'concise':
            return `IMPORTANT: Always answer very briefly and directly. Use 1-3 sentences maximum. Avoid long explanations.`;
        case 'normal':
            return `Answer clearly and completely, but without being too wordy. Use short paragraphs and get to the point.`;
        case 'detailed':
            return `You can provide detailed and in-depth answers when the topic requires it. Feel free to explain concepts carefully.`;
        default:
            return '';
    }
}

/**
 * Applies post-processing to a completed response.
 * Ensures sentence completion and handles edge cases.
 */
export function processCompletedResponse(text: string, _style: ResponseStyle): string {
    if (!text) return text;

    // Remove technical artifacts like [Final response]
    let processed = text.replace(/^\[Final response\]\s*/i, '');

    // User explicitly requested to remove message truncation as it breaks URLs
    // Returning trimmed text preserves validity of links and code.
    return processed.trim();
}
