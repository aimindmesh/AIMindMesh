import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  pending: [] as { type: 'meeting' | 'segment'; id: string; deletedAt: number }[],
  cleared: [] as unknown[],
  applied: [] as unknown[],
  runs: [] as unknown[][],
}));

vi.mock('@capacitor/device', () => ({ Device: { getId: async () => ({ identifier: 'phone-A' }) } }));
vi.mock('../src/services/calendar', () => ({ listCalendarEvents: async () => [], calendarEventSyncId: () => 'x' }));
vi.mock('../src/services/memory/memoryDatabase', () => ({
  getMemoryDatabase: async () => ({ query: async () => ({ values: [] }), run: async () => ({}) }),
  blobToFloat32Array: () => new Float32Array(),
}));
vi.mock('../src/services/database/meetingDatabase', () => ({
  getMeetingDatabase: async () => ({
    query: async () => ({ values: [] }),
    run: async (_sql: string, params: unknown[]) => { db.runs.push(params); return {}; },
  }),
  getPendingSyncDeletions: async () => db.pending,
  clearSyncDeletions: async (items: unknown[]) => { db.cleared.push(...items); },
  applyRemoteDeletions: async (items: unknown[]) => { db.applied.push(...items); },
}));

import { GlobalSyncService } from '../src/services/GlobalSyncService';

const settings = { enabled: true, serverUrl: 'http://srv', apiKey: 'k' } as any;
let pushed: any = null;
let pullBody: any;

beforeEach(() => {
  db.pending = []; db.cleared = []; db.applied = []; db.runs = [];
  pushed = null;
  pullBody = { deviceId: 'phone-A', timestamp: 100, meetings: [], meetingSegments: [], calendarEvents: [], chats: [], conversations: [], deletions: [] };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init?: any) => {
    const u = String(url);
    if (u.endsWith('/api/sync/push')) {
      pushed = JSON.parse(init.body);
      return new Response(JSON.stringify({ ok: true, timestamp: 1, failedMemoryIds: [] }), { status: 200 });
    }
    return new Response(JSON.stringify(pullBody), { status: 200 });
  });
});

describe('meeting deletions in the sync', () => {
  it('pushes local deletions and clears them only after a successful push', async () => {
    db.pending = [{ type: 'meeting', id: 'm1', deletedAt: 5 }];
    expect(await GlobalSyncService.performSync(settings)).toEqual({ ok: true });
    expect(pushed.deletions).toEqual([{ type: 'meeting', id: 'm1', deletedAt: 5 }]);
    expect(db.cleared).toEqual([{ type: 'meeting', id: 'm1', deletedAt: 5 }]);
  });

  it('keeps local deletions when the push fails', async () => {
    db.pending = [{ type: 'segment', id: 's1', deletedAt: 5 }];
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response('down', { status: 503 }));
    const result = await GlobalSyncService.performSync(settings);
    expect(result.ok).toBe(false);
    expect(db.cleared).toEqual([]);
  });

  it('applies deletions from other devices and never re-creates a row deleted here', async () => {
    pullBody.deletions = [{ type: 'meeting', id: 'm9', deletedAt: 7 }];
    pullBody.meetings = [{ id: 'm2', timestamp: 1, duration: 1, has_audio: 0 }, { id: 'm3', timestamp: 1, duration: 1, has_audio: 0 }];
    // m3 deleted locally after the push started (still pending at merge time)
    let calls = 0;
    db.pending = [];
    const original = db.pending;
    Object.defineProperty(db, 'pending', { configurable: true, get: () => (calls++ === 0 ? original : [{ type: 'meeting', id: 'm3', deletedAt: 9 }]) });

    expect(await GlobalSyncService.performSync(settings)).toEqual({ ok: true });
    expect(db.applied).toEqual([{ type: 'meeting', id: 'm9', deletedAt: 7 }]);
    const upserted = db.runs.map(p => p[0]);
    expect(upserted).toContain('m2');
    expect(upserted).not.toContain('m3');
  });
});
