import Anthropic from '@anthropic-ai/sdk';
import { claudeSettings } from './claudeSettings';

let cached: { key: string; timeoutMs: number; client: Anthropic } | null = null;

/**
 * The SDK client for the configured key, or null without one. The key is always passed
 * explicitly: with an empty key the SDK would fall back to ANTHROPIC_API_KEY or a local
 * `ant` login profile, and the server must never spend credentials it was not given.
 */
export function claudeClient(): Anthropic | null {
  const { apiKey, timeoutMs } = claudeSettings();
  if (!apiKey) return null;
  if (cached?.key !== apiKey || cached.timeoutMs !== timeoutMs) {
    cached = { key: apiKey, timeoutMs, client: new Anthropic({ apiKey, authToken: null, timeout: timeoutMs, maxRetries: 2 }) };
  }
  return cached.client;
}

/** Short fingerprint of the configured key: a changed key clears an authentication error. */
export function claudeKeyFingerprint(): string {
  const { apiKey } = claudeSettings();
  return apiKey ? `${apiKey.slice(0, 7)}…${apiKey.slice(-4)}` : '';
}
