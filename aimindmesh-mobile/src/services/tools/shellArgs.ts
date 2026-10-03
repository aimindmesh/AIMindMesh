/**
 * Building Termux shell commands from model-supplied arguments. Termux runs them with
 * `sh -c`, so every value must reach the shell as one inert word.
 */

/** Single-quotes a value for POSIX sh (a quote inside becomes '\'' ). */
export function shellQuote(value: unknown): string {
    return `'${String(value ?? '').replace(/'/g, `'\\''`)}'`;
}

/** Termux/apt package names: lowercase letters, digits and . + - (no spaces, no shell syntax) */
const PACKAGE_NAME = /^[a-z0-9][a-z0-9.+-]*$/;

/**
 * Package names from a tool argument ("python" or "python git"), or null when any of them
 * is not a plain package name.
 */
export function parsePackageNames(value: unknown): string[] | null {
    if (typeof value !== 'string') return null;
    const names = value.trim().split(/\s+/).filter(Boolean);
    if (names.length === 0 || names.length > 10) return null;
    return names.every(n => PACKAGE_NAME.test(n)) ? names : null;
}

/** Integer within [min, max], or the fallback when the value is not a number. */
export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
}
