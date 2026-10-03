/**
 * Server-side names for the AI task types. The contract lives in ./api (shared with the clients).
 */
import type { AiExecutionStatus, AiStoragePolicy } from './api';

export type { AiTaskDefinition, AiTaskExecution, AiProvider } from './api';

/** Status of a single execution (named AiExecutionStatus in the API contract). */
export type AiTaskStatus = AiExecutionStatus;
export type AiModel = string; // Flexible model name
export type StoragePolicy = AiStoragePolicy;
