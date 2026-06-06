import { Memory, LLMConfig } from '../../../types';

export interface MemorySettingsProps {
    memories: Memory[];
    onAddMemory: (content: string, category?: string) => void;
    onDeleteMemory: (id: string) => void;
    onClearMemories: () => void;
    memoryCategories: string[];
    onAddMemoryCategory: (category: string) => void;
    onDeleteMemoryCategory: (category: string) => void;
    onUpdateMemoryCategory: (id: string, newCategory: string) => void;
    onExportMemories: () => Promise<void>;
    onImportMemories: () => Promise<void>;
    enableAiMemoryCategorization: boolean;
    onEnableAiMemoryCategorizationChange: (enabled: boolean) => void;
    llmConfig: LLMConfig;
    onLlmConfigSave: (config: LLMConfig) => void;
    apiKey: string;
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
