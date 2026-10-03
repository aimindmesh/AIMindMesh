import { describe, expect, it } from 'vitest';
import { LOCK_TIMEOUT_MS, lockEngine, lockTimeoutMs } from '../src/services/inference/lockTimeouts';

describe('inference lock timeouts', () => {
  it('are per engine, shorter than the old 24h except for phones', () => {
    expect(lockTimeoutMs('GEMINI')).toBeLessThan(lockTimeoutMs('OLLAMA'));
    expect(lockTimeoutMs('OLLAMA')).toBeLessThan(24 * 60 * 60 * 1000);
    expect(lockTimeoutMs('MOBILE')).toBe(24 * 60 * 60 * 1000);
    expect(lockTimeoutMs('SOMETHING_NEW')).toBe(LOCK_TIMEOUT_MS.OLLAMA);
  });

  it('let an OpenClaw run reach its own 1h bridge timeout first', () => {
    expect(lockTimeoutMs('OPENCLAW')).toBeGreaterThan(60 * 60 * 1000);
  });

  it('read the engine from a lock key', () => {
    expect(lockEngine('SERVER_LOCAL:OLLAMA')).toBe('OLLAMA');
    expect(lockEngine('PIXEL_8:MOBILE')).toBe('MOBILE');
  });
});
