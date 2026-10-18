/**
 * The server masks secrets in GET /api/admin/config with this placeholder.
 */
export const REDACTED = '********';

/**
 * Deep-copies a server config dropping masked values, so merging it into the
 * local config never overwrites locally stored keys with the placeholder.
 * A list holding a masked value is dropped whole, like the server does: lists
 * replace the stored value on PATCH, so a filtered list would wipe the real one.
 */
export function withoutRedacted<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.filter(v => v !== REDACTED).map(withoutRedacted) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === REDACTED || (Array.isArray(v) && v.includes(REDACTED))) continue;
      out[k] = withoutRedacted(v);
    }
    return out as T;
  }
  return value;
}
