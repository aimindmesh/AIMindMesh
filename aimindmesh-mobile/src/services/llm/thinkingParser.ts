/**
 * Logic for parsing <thinking> and <tool> tags from LLM output streams
 */

import { StreamChunk } from './llmService';

interface ThinkingParserState {
    buffer: string;
    isInThinking: boolean;
    isInTool: boolean;
}

/**
 * Creates a thinking parser that yields StreamChunks.
 * It manages the buffer and state internally.
 * Also strips <tool>...</tool> tags from visible output.
 */
export function createThinkingParser() {
    const state: ThinkingParserState = {
        buffer: '',
        isInThinking: false,
        isInTool: false
    };

    /**
     * Strip tool tags from text (they should not be visible to user)
     */
    function stripToolTags(text: string): string {
        // Remove complete [tool]...[/tool] blocks
        let result = text.replace(/\[tool\][\s\S]*?\[\/tool\]/gi, '');
        // Remove orphaned opening/closing tags
        result = result.replace(/\[\/?tool\]/gi, '');
        // Also support legacy XML tags just in case
        result = result.replace(/<tool>[\s\S]*?<\/tool>/gi, '');
        result = result.replace(/<\/?tool>/gi, '');
        return result;
    }

    /**
     * Helper to find the start of a thinking block
     */
    function findThinkingStart(buffer: string): { index: number; length: number; tag: string } | null {
        // Match <think>, <thinking>, [thinking], <thought>, [thought], <|channel>thought, Thinking Process:, Thought:
        const match = buffer.match(/<think(?:ing)?>|\[thinking\]|<thought>|\[thought\]|<\|channel(?:\|)?>thought|Thinking Process:|Thought:/i);
        if (match && match.index !== undefined) {
            return { index: match.index, length: match[0].length, tag: match[0] };
        }
        return null;
    }

    /**
     * Helper to find the end of a thinking block
     */
    function findThinkingEnd(buffer: string): { index: number; length: number } | null {
        // Match </think>, </thinking>, [/thinking], </thought>, [/thought], <channel|>
        const match = buffer.match(/<\/think(?:ing)?>|\[\/thinking\]|<\/thought>|\[\/thought\]|<\|?channel\|?>/i);
        if (match && match.index !== undefined) {
            return { index: match.index, length: match[0].length };
        }
        return null;
    }

    /**
     * Process a new text chunk and yield parsed Thinking/Text chunks
     */
    function* processChunk(chunk: string): Generator<StreamChunk, void, unknown> {
        state.buffer += chunk;

        while (true) {
            // First check for tool tags and strip them
            if (!state.isInThinking && !state.isInTool) {
                // Check for tool tag before thinking
                const toolStartMatch = state.buffer.match(/\[tool\]|<tool>/);
                const thinkingStart = findThinkingStart(state.buffer);

                const toolStartIdx = toolStartMatch?.index ?? -1;
                const toolTagLen = toolStartMatch?.[0].length ?? 0;

                const thinkingStartIdx = thinkingStart?.index ?? -1;

                // Handle tool tag (just strip it, don't yield)
                if (toolStartIdx !== -1 && (thinkingStartIdx === -1 || toolStartIdx < thinkingStartIdx)) {
                    const textBefore = state.buffer.substring(0, toolStartIdx);
                    if (textBefore.trim()) {
                        yield { type: 'text', content: textBefore };
                    }
                    state.buffer = state.buffer.substring(toolStartIdx + toolTagLen);
                    state.isInTool = true;
                    continue;
                }
            }

            // Handle being inside a tool block
            if (state.isInTool) {
                // Match [/tool] or </tool>
                const toolEndMatch = state.buffer.match(/\[\/tool\]|<\/tool>/);

                if (toolEndMatch && toolEndMatch.index !== undefined) {
                    // Found closing tag - skip tool content entirely
                    state.buffer = state.buffer.substring(toolEndMatch.index + toolEndMatch[0].length);
                    state.isInTool = false;
                    continue;
                } else {
                    // No closing tag yet, wait for more data
                    // But check for partial closing tag
                    if (state.buffer.length > 20) {
                        // Keep only last 20 chars
                        state.buffer = state.buffer.substring(state.buffer.length - 20);
                    }
                    break;
                }
            }

            if (!state.isInThinking) {
                // Look for opening tag
                const startInfo = findThinkingStart(state.buffer);

                if (startInfo) {
                    // Yield text before the thinking tag/text (with tool tags stripped)
                    const textBefore = stripToolTags(state.buffer.substring(0, startInfo.index));
                    if (textBefore) {
                        yield { type: 'text', content: textBefore };
                    }
                    state.buffer = state.buffer.substring(startInfo.index + startInfo.length);
                    state.isInThinking = true;
                    continue;
                } else {
                    // No opening tag found - check for partial
                    // Safe limit check to yield text
                    if (state.buffer.length > 20) {
                        // Keep last 20 chars to be safe for broken tags/patterns
                        // But ensure we don't cut off a partial tag like "<thi"
                        const safeText = stripToolTags(state.buffer.substring(0, state.buffer.length - 20));
                        if (safeText) {
                            yield { type: 'text', content: safeText };
                        }
                        state.buffer = state.buffer.substring(state.buffer.length - 20);
                    }
                    break;
                }
            } else {
                // Inside thinking block - look for closing tag OR [tool] (implicit close)
                const endInfo = findThinkingEnd(state.buffer);
                const toolStartMatch = state.buffer.match(/\[tool\]|<tool>/);
                const toolStartIdx = toolStartMatch?.index ?? -1;

                let closeIdx = -1;
                let closeLen = 0;

                if (endInfo) {
                    closeIdx = endInfo.index;
                    closeLen = endInfo.length;
                }

                // If tool starts before explicit close, terminate thinking
                if (toolStartIdx !== -1 && (closeIdx === -1 || toolStartIdx < closeIdx)) {
                    closeIdx = toolStartIdx;
                    closeLen = 0; // Don't consume the tool tag!
                }

                // Check for "Answer:" or "Final Answer:" pattern to terminate thinking
                const answerMatch = state.buffer.match(/(?:^|\n)(?:Final )?Answer:\s*/i);
                if (answerMatch && answerMatch.index !== undefined) {
                    const answerIdx = answerMatch.index;
                    // If answer starts before other closers
                    if (closeIdx === -1 || answerIdx < closeIdx) {
                        closeIdx = answerIdx;
                        closeLen = 0; // Don't consume it here, let next loop handle it as text
                    }
                }

                if (closeIdx !== -1) {
                    // Found closing
                    const thinkingContent = state.buffer.substring(0, closeIdx);
                    if (thinkingContent) {
                        yield { type: 'thinking', content: thinkingContent };
                    }
                    // Move past the closing tag (or don't if implicit)
                    state.buffer = state.buffer.substring(closeIdx + closeLen);
                    state.isInThinking = false;
                    // Continue loop to process any remaining text (e.g. the [tool] we stopped at)
                } else {
                    // No closing yet. Stream content.
                    const SAFE_LENGTH = 15; // length of longest closing tag like </thinking>

                    if (state.buffer.length > SAFE_LENGTH) {
                        const splitIndex = state.buffer.length - SAFE_LENGTH;
                        const safeContent = state.buffer.substring(0, splitIndex);

                        if (safeContent) {
                            yield { type: 'thinking', content: safeContent };
                            state.buffer = state.buffer.substring(splitIndex);
                        }
                    }
                    break;
                }
            }
        }
    }

    /**
     * Call this when the stream ends to flush any remaining buffer
     */
    function* flush(): Generator<StreamChunk, void, unknown> {
        if (state.isInTool) {
            // Discard any remaining tool content
            state.buffer = '';
        } else if (state.isInThinking && state.buffer) {
            // Model produced [thinking] but never closed it
            // Yield the buffered content as thinking (without raw tags)
            yield { type: 'thinking', content: state.buffer.replace(/<\/?think(?:ing)?>|\[\/?thinking\]|<\/?thought>|\[\/?thought\]|<\|?channel(?:\|)?(?:>thought)?>/gi, '').trim() };
        } else if (state.buffer) {
            yield { type: 'text', content: stripToolTags(state.buffer) };
        }
        state.buffer = '';
    }

    return { processChunk, flush };
}

