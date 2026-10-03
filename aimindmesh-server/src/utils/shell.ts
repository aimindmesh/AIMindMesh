/**
 * Quotes a value for safe use as a single POSIX `sh` argument.
 * Prefer execFile/spawn with an args array; use this only when a command
 * must run through a remote shell (e.g. `docker exec ... sh -c`).
 */
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
