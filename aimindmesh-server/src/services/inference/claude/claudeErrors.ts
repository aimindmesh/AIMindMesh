import Anthropic from '@anthropic-ai/sdk';

/**
 * - credit: the organization has no API credit left (402 billing_error, or a 400 about the credit balance)
 * - budget: the internal monthly budget is spent
 * - auth: the key is wrong or lacks permission (401/403)
 * - unavailable: the model or a beta is not available to this organization (404, rejected beta)
 * - transient: rate limit, overload, server or connection error (the SDK already retried)
 * - invalid: the request itself was rejected (other 4xx)
 * - refusal: the model declined (stop_reason "refusal", after the server-side fallback)
 * - truncated: the answer hit max_tokens where a cut answer is useless
 * - aborted: the router or the caller cancelled the call
 */
export type ClaudeErrorKind = 'credit' | 'budget' | 'auth' | 'unavailable' | 'transient' | 'invalid' | 'refusal' | 'truncated' | 'aborted';

export class ClaudeError extends Error {
  constructor(public readonly kind: ClaudeErrorKind, detail: string, public readonly status?: number) {
    super(`CLAUDE_${kind.toUpperCase()}: ${detail}`);
    this.name = 'ClaudeError';
  }
}

const CREDIT_MESSAGE = /credit balance/i;
const BETA_MESSAGE = /anthropic-beta|fallbacks|block_binding/i;

/** True for a 400 caused by a beta header or beta field this organization does not accept. */
export function isRejectedBeta(err: unknown): boolean {
  return err instanceof Anthropic.APIError && err.status === 400 && BETA_MESSAGE.test(err.message) && !CREDIT_MESSAGE.test(err.message);
}

/** Maps any error of a Claude call to a ClaudeError. Only SDK errors are classified by status. */
export function classifyClaudeError(err: unknown): ClaudeError {
  if (err instanceof ClaudeError) return err;
  if (err instanceof Anthropic.APIUserAbortError || (err as any)?.name === 'AbortError') {
    return new ClaudeError('aborted', 'call aborted');
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new ClaudeError('transient', err.message);
  }
  if (err instanceof Anthropic.APIError) {
    const status = err.status as number | undefined;
    const message = err.message || String(status);
    if (status === 402 || err.type === 'billing_error' || (status === 400 && CREDIT_MESSAGE.test(message))) {
      return new ClaudeError('credit', message, status);
    }
    if (status === 401 || status === 403) return new ClaudeError('auth', message, status);
    if (status === 404) return new ClaudeError('unavailable', message, status);
    if (status === 429 || status === 529 || status === 408 || (status !== undefined && status >= 500)) {
      return new ClaudeError('transient', message, status);
    }
    return new ClaudeError('invalid', message, status);
  }
  return new ClaudeError('transient', (err as Error)?.message ?? String(err));
}
