import { beforeEach, describe, expect, it, vi } from 'vitest';

const plugin = vi.hoisted(() => ({ setSecureScreen: vi.fn(async () => { }) }));
vi.mock('@capacitor/core', () => ({ registerPlugin: () => plugin }));

import { isAppLockEnabled, RELOCK_AFTER_MS, setAppLockEnabled, shouldRelock } from '../src/services/security/appLock';

describe('app lock setting', () => {
  beforeEach(() => {
    localStorage.clear();
    plugin.setSecureScreen.mockClear();
  });

  it('is off until turned on, and follows FLAG_SECURE', () => {
    expect(isAppLockEnabled()).toBe(false);
    setAppLockEnabled(true);
    expect(isAppLockEnabled()).toBe(true);
    expect(plugin.setSecureScreen).toHaveBeenLastCalledWith({ enabled: true });
    setAppLockEnabled(false);
    expect(isAppLockEnabled()).toBe(false);
    expect(plugin.setSecureScreen).toHaveBeenLastCalledWith({ enabled: false });
  });
});

describe('shouldRelock', () => {
  const now = 1_700_000_000_000;

  it('asks again only after more than a minute in the background', () => {
    expect(shouldRelock(true, now - RELOCK_AFTER_MS - 1, now)).toBe(true);
    expect(shouldRelock(true, now - RELOCK_AFTER_MS, now)).toBe(false);
    expect(shouldRelock(true, now - 5_000, now)).toBe(false);
  });

  it('never locks when the lock is off or the app was not in the background', () => {
    expect(shouldRelock(false, now - 10 * RELOCK_AFTER_MS, now)).toBe(false);
    expect(shouldRelock(true, null, now)).toBe(false);
  });
});
