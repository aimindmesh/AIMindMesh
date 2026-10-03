import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenGate, initialOpenRouterKey } from '../src/hooks/settingsOpenGate';
import { createWriteThrottle } from '../src/hooks/writeThrottle';
import { isKeepAliveEnabled, migrateLegacyKeepAlive, resetKeepAliveCache, setKeepAliveEnabled } from '../src/services/performance/keepAliveSetting';
import { registerBackHandler, runBackHandler } from '../src/services/native/backButtonRegistry';

describe('settings modal reset', () => {
  it('copies the saved settings only when the modal opens', () => {
    const opened = createOpenGate();
    expect(opened(false)).toBe(false);
    expect(opened(true)).toBe(true);   // open: copy
    expect(opened(true)).toBe(false);  // App re-render while open: keep edits
    expect(opened(true)).toBe(false);
    expect(opened(false)).toBe(false); // closed
    expect(opened(true)).toBe(true);   // opened again: copy again
  });

  it('reads the OpenRouter key from llmConfig, falling back to the old field', () => {
    expect(initialOpenRouterKey('sk-or-new', 'sk-or-old')).toBe('sk-or-new');
    expect(initialOpenRouterKey('', 'sk-or-old')).toBe(''); // cleared on purpose
    expect(initialOpenRouterKey(undefined, 'sk-or-old')).toBe('sk-or-old');
    expect(initialOpenRouterKey(undefined, undefined)).toBe('');
  });
});

describe('storage write throttle', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('writes the first change at once and coalesces a burst into one trailing write', () => {
    vi.useFakeTimers();
    const writes: number[] = [];
    const throttle = createWriteThrottle<number>(v => writes.push(v), 1000);

    throttle.push(1);
    expect(writes).toEqual([1]);
    for (let i = 2; i <= 10; i++) { vi.advanceTimersByTime(100); throttle.push(i); } // streaming
    expect(writes).toEqual([1]);
    vi.advanceTimersByTime(1000);
    expect(writes).toEqual([1, 10]); // only the newest value

    vi.advanceTimersByTime(5000);
    throttle.push(11); // a later single edit is immediate again
    expect(writes).toEqual([1, 10, 11]);
  });

  it('flush writes a pending value immediately', () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const throttle = createWriteThrottle<string>(v => writes.push(v), 1000);
    throttle.push('a');
    throttle.push('b');
    throttle.flush();
    expect(writes).toEqual(['a', 'b']);
    vi.advanceTimersByTime(2000);
    expect(writes).toEqual(['a', 'b']);
  });
});

describe('keep-alive flag', () => {
  it('adopts the legacy llmConfig.keepAlive only when the shared flag was never set', () => {
    resetKeepAliveCache();
    migrateLegacyKeepAlive(true);
    expect(isKeepAliveEnabled()).toBe(true);
    expect(localStorage.getItem('keep_alive_enabled')).toBe('true');

    setKeepAliveEnabled(false);
    resetKeepAliveCache(); // next launch
    migrateLegacyKeepAlive(true); // the user turned it off: stays off
    expect(isKeepAliveEnabled()).toBe(false);
  });

  it('reads the value PerformanceSettings used to write', () => {
    localStorage.setItem('keep_alive_enabled', 'true');
    resetKeepAliveCache();
    expect(isKeepAliveEnabled()).toBe(true);
  });
});

describe('back button registry', () => {
  it('runs the registered screen handler and forgets it on unregister', () => {
    expect(runBackHandler('meeting')).toBeUndefined();
    const close = vi.fn(() => true);
    const unregister = registerBackHandler('meeting', close);
    expect(runBackHandler('meeting')).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    unregister();
    expect(runBackHandler('meeting')).toBeUndefined();
  });
});
