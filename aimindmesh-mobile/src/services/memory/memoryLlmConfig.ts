import { LLMConfig } from '../../types';

/**
 * Config for internal memory tasks (extraction, summaries, consolidation, concept
 * extraction). Without it the providers would inject retrieved memories and tool
 * instructions into the task prompt, and those would leak into the stored result.
 */
export function memoryTaskConfig(config: LLMConfig): LLMConfig {
    return { ...config, enableSemanticMemory: false, enableToolCalling: false, enableThinking: false };
}
