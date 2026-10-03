/**
 * Masks credentials in the server config before it leaves the server,
 * and drops masked values coming back from clients so they never overwrite real secrets.
 */
export const REDACTED = '********';

// Matches apiKey, apiKeySecret, apiKeys, giteaWebhookSecret, password, testToken, auth.keys, ...
const SECRET_KEY = /(apikey|apikeys|apikeysecret|secret|password|passwd|token|keys)$/i;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function redactValue(value: any, underSecret: boolean): any {
  if (Array.isArray(value)) return value.map(v => redactValue(v, underSecret));
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactValue(v, underSecret || SECRET_KEY.test(k));
    }
    return out;
  }
  if (underSecret && typeof value === 'string' && value.length > 0) return REDACTED;
  return value;
}

export function redactConfig<T>(cfg: T): T {
  return redactValue(cfg, false);
}

/**
 * Removes masked placeholders and prototype-polluting keys from a partial config update.
 */
export function stripRedacted(partial: any): any {
  if (Array.isArray(partial)) return partial.filter(v => v !== REDACTED).map(stripRedacted);
  if (partial && typeof partial === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(partial)) {
      if (UNSAFE_KEYS.has(k) || v === REDACTED) continue;
      out[k] = stripRedacted(v);
    }
    return out;
  }
  return partial;
}
