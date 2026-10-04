import { Type } from '@google/genai';

// Internal type for our tool parameters (more flexible)
export interface ToolParameter {
    type: Type;
    description: string;
    enum?: string[];
    items?: { type: Type };
}

export type ToolConfirmationMode = 'always' | 'risky' | 'never' | 'dangerous';

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: {
        type: Type.OBJECT;
        properties: Record<string, ToolParameter>;
        required: string[];
    };
    requiresConfirmation: boolean;
    confirmationMode?: ToolConfirmationMode;
    category: 'agenda' | 'calendar' | 'todo' | 'notification' | 'memory' | 'files' | 'system' | 'web' | 'media' | 'app' | 'communication' | 'device';
    handler?: (params: any) => Promise<string | any>;
    /** Offered to the model only while this returns true (e.g. a server feature that is off) */
    isAvailable?: () => boolean;
}

export interface ToolResult {
    success: boolean;
    output?: any;
    error?: string;
    data?: any;
    message: string; // Made required
    /** Web pages the result comes from, shown as sources under the answer */
    sources?: { title: string; uri: string }[];
}

export interface ToolCall {
    name: string;
    args: Record<string, any>; // Aligned with llmService and parseReActToolCalls
    id?: string;
}

export interface ToolExecutorContext {
    llmConfig: any;
    userContext?: any;
    todos: any[];
    addTodo: (text: string) => void;
    completeTodo: (id: string) => void;
    confirmationMode: ToolConfirmationMode;
}
