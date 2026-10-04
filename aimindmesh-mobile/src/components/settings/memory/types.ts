import { LLMConfig } from '../../../types';
import type { MemoryFactsApi } from '../../../hooks/useMemoryFacts';

export interface MemorySettingsProps {
    memory: MemoryFactsApi;
    /** Asks for confirmation before deleting everything */
    onClearAll: () => void;
    llmConfig: LLMConfig;
    onLlmConfigSave: (config: LLMConfig) => void;
}

export interface EmbeddingModel {
    id: string;
    name: string;
    dimension: number;
}

export interface SemanticMemory {
    id: string;
    sessionId: string;
    timestamp: number;
    role: string;
    content: string;
    category: string;
}
