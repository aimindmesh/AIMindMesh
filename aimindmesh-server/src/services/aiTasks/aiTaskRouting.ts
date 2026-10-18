import type { TaskType } from '../InferenceRouter';

/**
 * Maps an AI task's provider/model to InferenceRouter options at execution time.
 *
 * Clients used to store the provider name ("gemini", "ollama", ...) in `model` and leave
 * `provider` = 'auto'. Stored rows are not rewritten (the desktop UI filters on `model`):
 * they are interpreted here instead. A provider name is never passed on as a model id,
 * because any explicit model forces the Ollama engine in the router.
 */

const PROVIDER_ROUTING: Record<string, string> = {
  ollama: 'SERVER_LOCAL',
  gemini: 'GEMINI',
  openrouter: 'OPENROUTER',
  claude: 'CLAUDE',
  openclaw: 'OPENCLAW',
  hermes: 'HERMES',
};

export interface AiTaskRouting {
  taskType: TaskType;
  provider: string;
  routing?: string;
  model?: string;
}

export function resolveAiTaskRouting(task: { provider?: string | null; model?: string | null }): AiTaskRouting {
  const provider = String(task.provider || 'auto').trim().toLowerCase();
  const model = String(task.model || '').trim();
  const modelIsProviderName = model.toLowerCase() === 'auto' || model.toLowerCase() in PROVIDER_ROUTING;

  const effectiveProvider = provider !== 'auto' ? provider : (modelIsProviderName ? model.toLowerCase() : 'auto');
  const routing = effectiveProvider === 'auto'
    ? undefined
    : (PROVIDER_ROUTING[effectiveProvider] ?? effectiveProvider.toUpperCase());

  return {
    taskType: effectiveProvider === 'openclaw' ? 'AGENTIC_TASK' : 'SCHEDULED_TASK',
    provider: effectiveProvider,
    routing,
    model: model && !modelIsProviderName ? model : undefined,
  };
}
