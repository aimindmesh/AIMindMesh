import { Message, Memory, ImageAttachment } from '../../types';

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

/** Outcome of one tool call, shown in the bubble and fed back to the model */
export interface ToolRunResult {
    name: string;
    success: boolean;
    result: string;
}

/** State of a run paused on a tool that needs the user's confirmation */
export interface AgentContext {
    conversationHistory: Message[];
    modelMessageId: string;
    currentIteration: number;
    maxIterations: number;
    accumulatedThinking: string;
    accumulatedResponse: string;
    accumulatedSources: any[];
    /** Every result of the run (shown in the bubble) */
    accumulatedToolResults: ToolRunResult[];
    iterationResponse: string;
    /** Calls of the current batch not run yet; the first one is waiting for confirmation */
    pendingToolCalls: ToolCall[];
    /** Results of the current batch so far (the observation sent to the model) */
    batchResults: ToolRunResult[];
    /** Model turn that requested the current batch, recorded in history once it completes */
    batchModelText: string;
    /** Images tools produced in this run (generate_image), shown in the answer bubble */
    generatedImages?: ImageAttachment[];
}
