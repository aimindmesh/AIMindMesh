/**
 * Provider ids and task categories of the inference router, in one place: the stale check,
 * the leaked-lock check, Gitea indexing and the priority lists used to spell them inline.
 */

/** Cloud targets: never "offline" nodes. `*_API` are the spellings the admin apps send. */
const CLOUD_PROVIDERS = new Set(['GEMINI', 'GEMINI_API', 'OPENROUTER', 'OPENROUTER_API', 'FREELLMAPI', 'CLAUDE']);

export function isCloudProvider(target: string | null | undefined): boolean {
  return !!target && CLOUD_PROVIDERS.has(target.toUpperCase());
}

/**
 * Target of a PROCESSING task that the stale check must not treat as a node: no target yet,
 * AUTO, a cloud provider, or any id containing "API" (the historical rule, kept for old rows).
 */
export function isCloudTarget(target: string | null | undefined): boolean {
  if (!target) return true;
  const upper = target.toUpperCase();
  return upper === 'AUTO' || upper.includes('API') || isCloudProvider(upper);
}

/** Lock key (`TARGET:ENGINE`) of a cloud provider: a leaked one is dropped after a short grace. */
export function isCloudLock(lockKey: string): boolean {
  return lockKey.includes('GEMINI') || lockKey.includes('OPENROUTER') || lockKey.startsWith('CLAUDE:');
}

export type TaskCategory = 'LIGHTWEIGHT' | 'STANDARD' | 'COMPLEX' | 'EVOLUTION' | 'EMBEDDING' | 'RESEARCH' | 'AGENTIC';

/** Category of each task type: the fallback key of the routing priority lists. */
const TASK_CATEGORY: Record<string, TaskCategory> = {
  INTENT_CLASSIFICATION: 'LIGHTWEIGHT',
  QUERY_EXPANSION: 'LIGHTWEIGHT',
  CONCEPT_EXTRACTION: 'LIGHTWEIGHT',
  CONCEPT_ENRICHMENT: 'LIGHTWEIGHT',
  IMPROVEMENT_DETECTION: 'LIGHTWEIGHT',
  PROACTIVE_INSIGHT: 'STANDARD',
  DEBATE_PARTICIPATION: 'STANDARD',
  INSIGHT_DEDUP: 'STANDARD',
  DEBATE_SUMMARY: 'STANDARD',
  GENERAL_CHAT: 'STANDARD',
  SCHEDULED_TASK: 'STANDARD',
  WIKI_SYNTHESIS: 'COMPLEX',
  WIKI_TOPIC_MAP: 'COMPLEX',
  CODE_EVOLUTION: 'EVOLUTION',
  EVOLUTION_VALIDATION: 'STANDARD',
  EMBEDDING_GENERATION: 'EMBEDDING',
  WEB_RESEARCH: 'RESEARCH',
  AGENTIC_TASK: 'AGENTIC',
  DIRECTIVES_EXTRACTION: 'STANDARD',
  // Specs and role designs: a plain completion, never the tool-using agent
  ORGANIZATION_DESIGN: 'COMPLEX',
};

/** Every task type with a routing priority list (EVOLUTION first: it is also a category key). */
export const ROUTED_TASK_TYPES: string[] = ['EVOLUTION', ...Object.keys(TASK_CATEGORY)];

/** Category of a task type; EVOLUTION is both a type and its own category. */
export function taskCategory(type: string): TaskCategory | null {
  if (type === 'EVOLUTION') return 'EVOLUTION';
  return TASK_CATEGORY[type] ?? null;
}
