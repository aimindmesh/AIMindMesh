import { LLMConfig } from '../../types';
import { asInternalTask } from '../llm/background/taskFlags';

/**
 * Config for internal memory tasks (extraction, summaries, consolidation, concept
 * extraction). Without it the providers would inject retrieved memories, workspace documents,
 * tool instructions and the inline <save_memory> rule into the task prompt, and those would
 * leak into the stored result. Marked as an internal task: providers send only the task's
 * own system text.
 */
export function memoryTaskConfig(config: LLMConfig): LLMConfig {
    return asInternalTask({ ...config, enableSemanticMemory: false, enableToolCalling: false, enableThinking: false, enableSearch: false });
}
