/**
 * Validation of client-supplied routing hints before they reach the InferenceRouter.
 */

/** Node id or provider name (GEMINI, OPENCLAW, a node id...); undefined means automatic routing. */
export function normalizeRouting(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const routing = value.trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(routing) || routing.toUpperCase() === 'AUTO') return undefined;
  return routing;
}

/** Explicit model id (e.g. "anthropic/claude-3.5-sonnet", "llama3:8b"); undefined lets the provider choose. */
export function normalizeModel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const model = value.trim();
  if (!model || model.length > 128 || !/^[\w.:/@+-]+$/.test(model)) return undefined;
  return model;
}
