export type AiTaskStatus = 'scheduled' | 'queued' | 'running' | 'completed' | 'failed' | 'needs_review';
export type AiModel = string; // Flexible model name
export type AiProvider = 'auto' | 'ollama' | 'gemini' | 'openrouter' | 'openclaw';
export type StoragePolicy = 'server_disk' | 'server_disk_gitea';

export interface AiTaskDefinition {
  id: string;
  title: string;
  promptTemplate: string;
  model: AiModel;
  provider: AiProvider;
  outputFormat: string;
  storagePolicy: StoragePolicy;
  requiresReview: boolean;
  cronExpression?: string;
  scheduledAt?: number;
  status: 'active' | 'paused';
  createdAt: number;
  updatedAt: number;
}

export interface AiTaskExecution {
  executionId: string;
  taskId: string;
  status: AiTaskStatus;
  startedAt?: number;
  completedAt?: number;
  errorMessage?: string;
  artifactPath?: string;
  giteaCommitUrl?: string;
  outputSummary?: string;
  updatedAt: number;
}
