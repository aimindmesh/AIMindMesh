import db from '../../../db/sqlite';
import type { VentureBuildConfig } from '../../../types/api';

/**
 * Settings of the venture build loop (development agent + validation), stored as one JSON row
 * in system_settings and edited from the Organization panel.
 *
 * `enabled` is the kill switch: while it is false no development agent run, validation or
 * watchdog resume starts, whatever triggers it. `maxAttempts` failed attempts block a repository
 * until a human unblocks it.
 */
export type BuildSettings = VentureBuildConfig;

const SETTINGS_ID = 'organization.build';

export const DEFAULT_BUILD_SETTINGS: Readonly<BuildSettings> = Object.freeze({
  enabled: false,
  model: null,
  maxAttempts: 4,
  dailyRunLimit: 6,
  maxConcurrentBuilds: 1,
  maxRunsPerVenture: 12,
  agentRunTimeoutMs: 45 * 60_000,
  validationImage: 'node:22-bookworm-slim',
  validationTimeoutMs: 20 * 60_000,
});

const LIMITS: Record<'maxAttempts' | 'dailyRunLimit' | 'maxConcurrentBuilds' | 'maxRunsPerVenture' | 'agentRunTimeoutMs' | 'validationTimeoutMs', [number, number]> = {
  maxAttempts: [1, 20],
  dailyRunLimit: [1, 100],
  maxConcurrentBuilds: [1, 4],
  maxRunsPerVenture: [1, 200],
  agentRunTimeoutMs: [60_000, 4 * 3_600_000],
  validationTimeoutMs: [60_000, 2 * 3_600_000],
};

// Docker image reference: name[:tag][@sha256:digest], no options or shell syntax
const IMAGE_REF = /^[a-z0-9][a-z0-9._\/-]*(:[\w.-]+)?(@sha256:[a-f0-9]{64})?$/;
const MODEL_REF = /^[\w.\/:-]{1,120}$/;

function clamp(value: unknown, [min, max]: [number, number], fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

/** Keeps known keys with valid values; anything else falls back to the current value. */
export function normalizeBuildSettings(input: Partial<Record<keyof BuildSettings, unknown>>, base: BuildSettings = { ...DEFAULT_BUILD_SETTINGS }): BuildSettings {
  const out: BuildSettings = { ...base };
  if (typeof input.enabled === 'boolean') out.enabled = input.enabled;
  if (input.model === null || input.model === '') out.model = null;
  else if (typeof input.model === 'string' && MODEL_REF.test(input.model.trim())) out.model = input.model.trim();
  for (const key of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
    if (input[key] !== undefined) out[key] = clamp(input[key], LIMITS[key], base[key]);
  }
  if (typeof input.validationImage === 'string' && IMAGE_REF.test(input.validationImage.trim())) {
    out.validationImage = input.validationImage.trim();
  }
  return out;
}

export function getBuildSettings(): BuildSettings {
  try {
    const row = db.prepare('SELECT value FROM system_settings WHERE id = ?').get(SETTINGS_ID) as { value: string } | undefined;
    return row ? normalizeBuildSettings(JSON.parse(row.value)) : { ...DEFAULT_BUILD_SETTINGS };
  } catch {
    return { ...DEFAULT_BUILD_SETTINGS };
  }
}

export function updateBuildSettings(patch: Partial<Record<keyof BuildSettings, unknown>>): BuildSettings {
  const next = normalizeBuildSettings(patch, getBuildSettings());
  db.prepare('INSERT OR REPLACE INTO system_settings (id, value, updated_at) VALUES (?, ?, ?)')
    .run(SETTINGS_ID, JSON.stringify(next), Date.now());
  return next;
}

export function isBuildEnabled(): boolean {
  return getBuildSettings().enabled;
}
