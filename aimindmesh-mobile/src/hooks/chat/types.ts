import { Message, Memory } from '../../types';

export interface ChatContext {
    todos: any[];
    addTodo: (text: string) => void;
    completeTodo: (id: string) => void;
    memories: Memory[];
    addMemory: (content: string, category?: string) => void;
    showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export interface ApiKeys {
    gemini: string;
    perplexity: string;
    claude: string;
}

import { ToolCall } from '../../services/tools/types';
export type { ToolCall };

export interface AgentContext {
    conversationHistory: Message[];
    modelMessageId: string;
    currentIteration: number;
    maxIterations: number;
    accumulatedThinking: string;
    accumulatedResponse: string;
    accumulatedSources: any[];
    accumulatedToolResults: any[];
    iterationResponse: string;
    pendingToolCalls: ToolCall[];
}
