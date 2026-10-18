const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Merges a partial config update into `target` (mutated and returned). Objects merge key by key;
 * arrays and plain values replace what is stored, so an update can also shorten a list (priority
 * lists, debate participants). Prototype-polluting keys are ignored.
 */
export function deepMerge(target: any, source: any): any {
  for (const key of Object.keys(source ?? {})) {
    if (UNSAFE_KEYS.has(key)) continue;
    const value = source[key];
    if (isPlainObject(value) && isPlainObject(target[key])) {
      deepMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}
