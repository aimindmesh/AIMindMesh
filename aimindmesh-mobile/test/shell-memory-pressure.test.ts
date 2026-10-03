import { describe, expect, it } from 'vitest';
import { classifyTrimLevel, getMemoryPressure, MemoryPressureLevel, PRESSURE_TTL_MS, reportMemoryPressure } from '../src/services/native/memoryMonitor';

describe('memory pressure levels', () => {
  it('maps the levels sent while the app runs', () => {
    expect(classifyTrimLevel(5)).toBe(MemoryPressureLevel.MODERATE);  // RUNNING_MODERATE
    expect(classifyTrimLevel(10)).toBe(MemoryPressureLevel.MODERATE); // RUNNING_LOW
    expect(classifyTrimLevel(15)).toBe(MemoryPressureLevel.CRITICAL); // RUNNING_CRITICAL
  });

  it('ignores the levels sent on every app switch / while in background', () => {
    for (const level of [20, 40, 60, 80]) expect(classifyTrimLevel(level)).toBeNull();
  });

  it('forgets a report after the TTL (Android never says memory is fine again)', () => {
    const now = 1_000_000;
    reportMemoryPressure(MemoryPressureLevel.CRITICAL, now);
    expect(getMemoryPressure(now + 1000)).toBe(MemoryPressureLevel.CRITICAL);
    expect(getMemoryPressure(now + PRESSURE_TTL_MS + 1)).toBe(MemoryPressureLevel.NORMAL);
  });
});
