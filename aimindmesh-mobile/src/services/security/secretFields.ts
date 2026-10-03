/**
 * Which stored settings are secrets.
 *
 * A secret is identified by its storage key, plus the field name for secrets nested in a
 * JSON settings object: "gemini-api-key", "aimindmesh-server-settings.apiKey".
 */

/** localStorage keys whose whole value is a secret string */
export const SECRET_KEYS = ['gemini-api-key', 'perplexity-api-key', 'claude-api-key', 'hf-token'] as const;

/** Secret fields inside JSON settings objects */
export const SECRET_FIELDS: Readonly<Record<string, readonly string[]>> = {
    'llm-config': ['openrouterApiKey'],
    'aimindmesh-server-settings': ['apiKey'],
};

export const secretId = (key: string, field?: string) => (field ? `${key}.${field}` : key);

/** Every secret id the app uses */
export const ALL_SECRET_IDS: string[] = [
    ...SECRET_KEYS,
    ...Object.entries(SECRET_FIELDS).flatMap(([key, fields]) => fields.map(field => secretId(key, field))),
];

export const isSecretKey = (key: string) => (SECRET_KEYS as readonly string[]).includes(key);
export const hasSecrets = (key: string) => isSecretKey(key) || key in SECRET_FIELDS;

/** Secrets contained in a stored value, by id ('' for an empty one). */
export function extractSecrets(key: string, value: unknown): Record<string, string> {
    if (isSecretKey(key)) return typeof value === 'string' ? { [key]: value } : {};
    const fields = SECRET_FIELDS[key];
    if (!fields || typeof value !== 'object' || value === null) return {};
    const found: Record<string, string> = {};
    for (const field of fields) {
        const secret = (value as Record<string, unknown>)[field];
        if (typeof secret === 'string') found[secretId(key, field)] = secret;
    }
    return found;
}

/**
 * Copy of a stored value without its secrets, for localStorage and app-settings.json.
 * A whole-key secret becomes undefined (the key is removed).
 */
export function stripSecrets<T>(key: string, value: T): T | undefined {
    if (isSecretKey(key)) return undefined;
    const fields = SECRET_FIELDS[key];
    if (!fields || typeof value !== 'object' || value === null) return value;
    const copy: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    for (const field of fields) delete copy[field];
    return copy as T;
}

/**
 * The stored value with its secrets filled in from `getSecret`.
 * `undefined` from getSecret leaves the value as it is (not migrated, or plain mode);
 * `''` means the secret was cleared.
 */
export function mergeSecrets<T>(key: string, value: T, getSecret: (id: string) => string | undefined): T {
    if (isSecretKey(key)) {
        const secret = getSecret(key);
        return (secret === undefined ? value : secret) as T;
    }
    const fields = SECRET_FIELDS[key];
    if (!fields || typeof value !== 'object' || value === null) return value;
    let merged = value as Record<string, unknown>;
    for (const field of fields) {
        const secret = getSecret(secretId(key, field));
        if (secret !== undefined) merged = { ...merged, [field]: secret };
    }
    return merged as T;
}
