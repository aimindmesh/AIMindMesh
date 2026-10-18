import type { TaskPayload } from '../InferenceRouter';

/**
 * The prompt a provider receives, assembled at dispatch time from the stored pieces: the
 * stored `prompt` is never rewritten, so a retry neither searches again nor wraps twice.
 */
export interface PromptParts {
  /** Stable leading context (Claude caches it; other providers get it first in the text) */
  cachePrefix?: string;
  /** Search instruction + results + the task prompt, or the task prompt alone */
  body: string;
}

function searchInstruction(searchContext: string): string {
  return `
### SYSTEM INSTRUCTION
You have access to real-time web search results provided below.
1. Use the [Search Results] to provide an accurate, up-to-date answer.
2. If the results contain the answer, prioritize them over your internal knowledge.
3. Use citations like [1], [2] based on the result indices.
4. If results are irrelevant, acknowledge them but rely on your internal knowledge if possible.
5. Tone: Helpful, precise, and objective.

[Search Results]
${searchContext}
### END SYSTEM INSTRUCTION
`;
}

export function promptParts(payload: TaskPayload): PromptParts {
  const body = payload.searchContext !== undefined
    ? `${searchInstruction(payload.searchContext)}\n\nUSER: ${payload.prompt}`
    : payload.prompt;
  return payload.cachePrefix ? { cachePrefix: payload.cachePrefix, body } : { body };
}

/** The whole prompt as one text, for providers without prompt caching. */
export function flattenPrompt(payload: TaskPayload): string {
  const { cachePrefix, body } = promptParts(payload);
  return cachePrefix ? `${cachePrefix}\n\n${body}` : body;
}
