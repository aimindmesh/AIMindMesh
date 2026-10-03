import { Message } from '../../types';

/**
 * Chat roles as each API expects them. Only 'model' messages are the assistant: hidden
 * 'system' messages (e.g. the autonomous call greeting) are instructions sent as user turns,
 * since most APIs and chat templates reject a system role in the middle of a conversation.
 */
export const toChatRole = (role: Message['role']): 'user' | 'assistant' =>
    role === 'model' ? 'assistant' : 'user';

/** Gemini `contents` accept only 'user' and 'model'. */
export const toGeminiRole = (role: Message['role']): 'user' | 'model' =>
    role === 'model' ? 'model' : 'user';

/** Text of the last message the user (or a hidden system trigger) sent, for retrieval queries. */
export function lastUserText(history: Message[]): string {
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].role !== 'model') return history[i].text || '';
    }
    return '';
}
