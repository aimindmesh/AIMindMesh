/**
 * The server masks secrets in GET /api/admin/config with this placeholder.
 */
export const REDACTED = '********';

/**
 * Deep-copies a server config dropping masked values, so merging it into the
 * local config never overwrites locally stored keys with the placeholder.
 */
export function withoutRedacted<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.filter(v => v !== REDACTED).map(withoutRedacted) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== REDACTED) out[k] = withoutRedacted(v);
    }
    return out as T;
  }
  return value;
}
