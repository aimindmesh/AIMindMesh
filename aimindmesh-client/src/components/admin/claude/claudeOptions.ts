import type { ClaudeStateName } from '@aimindmesh/api-types';

/** Claude models offered in the settings (the server accepts any `claude-*` id). */
export const CLAUDE_MODELS = [
  { value: 'claude-haiku-5-5', label: 'Haiku 5.5 · $0.10 / $0.50' },
  { value: 'claude-sonnet-5-5', label: 'Sonnet 5.5 · $2 / $10' },
  { value: 'claude-opus-5-5', label: 'Opus 5.5 · $4 / $20' },
  { value: 'claude-sonnet-5', label: 'Sonnet 5 · $2 / $10' },
  { value: 'claude-opus-5', label: 'Opus 5 · $5 / $25' },
  { value: 'claude-fable-5-1', label: 'Fable 5.1 · $10 / $50' },
];

export const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Task categories Claude serves, with the server defaults. */
export const CLAUDE_CATEGORIES = [
  { id: 'LIGHTWEIGHT', label: 'Lightweight', model: 'claude-haiku-5-5', effort: 'low' },
  { id: 'STANDARD', label: 'Standard', model: 'claude-sonnet-5-5', effort: 'medium' },
  { id: 'RESEARCH', label: 'Research', model: 'claude-sonnet-5-5', effort: 'medium' },
  { id: 'COMPLEX', label: 'Complex', model: 'claude-opus-5-5', effort: 'high' },
  { id: 'EVOLUTION', label: 'Evolution', model: 'claude-opus-5-5', effort: 'high' },
] as const;

export const CLAUDE_STATE_LABEL: Record<ClaudeStateName, string> = {
  ok: 'Active',
  no_key: 'No API key',
  credit_exhausted: 'Credit exhausted',
  budget_reached: 'Budget reached',
  auth_error: 'Key rejected',
  unavailable: 'Model unavailable',
};

/** Task types Claude never serves from the router (embeddings, tool-using agents). */
export const CLAUDE_EXCLUDED_TASKS = ['EMBEDDING_GENERATION', 'AGENTIC_TASK'];
