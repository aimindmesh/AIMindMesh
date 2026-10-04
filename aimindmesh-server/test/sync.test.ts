import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ upsertMemory: vi.fn() }));
vi.mock('../src/services/KGManager', () => ({ KGManager: { upsertMemory: mocks.upsertMemory } }));
vi.mock('../src/services/WikiSynthesisService', () => ({ WikiSynthesisService: { runCycle: vi.fn(async () => {}) } }));
vi.mock('../src/services/FCMDispatcher', () => ({ sendToDevice: vi.fn() }));

import db from '../src/db/sqlite';
import { SyncManager } from '../src/services/SyncManager';

const count = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
const meeting = { id: 'm1', timestamp: 1, duration: 60, has_audio: false };
const segment = (id: string, text: string) => ({ id, meeting_id: 'm1', sequence: 1, start_ms: 0, end_ms: 10, text });
const mobileThread = (messages: any[]) => ({
  id: 't1', title: 'Trip', created_at: '2026-10-01T10:00:00.000Z', updated_at: '2026-10-01T10:05:00.000Z', messages,
});

beforeEach(() => {
  db.exec(`DELETE FROM meeting_segments; DELETE FROM meetings; DELETE FROM calendar_events;
           DELETE FROM direct_chats; DELETE FROM conversations; DELETE FROM sync_cursors; DELETE FROM sync_tombstones;`);
  mocks.upsertMemory.mockReset().mockResolvedValue('kg-id');
});

describe('sync push', () => {
  it('updating a meeting keeps its segments (no INSERT OR REPLACE cascade)', async () => {
    await SyncManager.handlePush({ deviceId: 'A', timestamp: 1, meetings: [meeting], meetingSegments: [segment('s1', 'hello')] });
    await SyncManager.handlePush({ deviceId: 'A', timestamp: 2, meetings: [{ ...meeting, duration: 90 }] });

    expect(count(`SELECT COUNT(*) AS c FROM meeting_segments`)).toBe(1);
    expect(db.prepare(`SELECT duration FROM meetings WHERE id = 'm1'`).get()).toEqual({ duration: 90 });
  });

  it('is all or nothing for the SQLite part', async () => {
    const broken = { id: 'e1', start_time: 0, end_time: 1, title: null }; // title is NOT NULL
    await expect(SyncManager.handlePush({ deviceId: 'A', timestamp: 1, meetings: [meeting], calendarEvents: [broken] }))
      .rejects.toThrow(/NOT NULL/);
    expect(count(`SELECT COUNT(*) AS c FROM meetings`)).toBe(0);
  });

  it('skips segments of unknown meetings instead of failing every future push', async () => {
    await SyncManager.handlePush({ deviceId: 'A', timestamp: 1, meetingSegments: [segment('s1', 'orphan')] });
    expect(count(`SELECT COUNT(*) AS c FROM meeting_segments`)).toBe(0);
  });

  it('stores mobile threads (role model, text, ISO dates) with namespaced message ids', async () => {
    await SyncManager.handlePush({ deviceId: 'A', timestamp: 1, chats: [mobileThread([
      { id: '100', role: 'user', text: 'hi', timestamp: '2026-10-01T10:00:00.000Z' },
      { id: '101', role: 'model', text: 'hello', timestamp: '2026-10-01T10:00:05.000Z' },
    ])] });

    expect(db.prepare(`SELECT id, role, content, timestamp, device_id FROM direct_chats ORDER BY timestamp`).all()).toEqual([
      { id: 't1:100', role: 'user', content: 'hi', timestamp: Date.parse('2026-10-01T10:00:00.000Z'), device_id: 'A' },
      { id: 't1:101', role: 'assistant', content: 'hello', timestamp: Date.parse('2026-10-01T10:00:05.000Z'), device_id: 'A' },
    ]);
  });

  it('a message pushed back unchanged by another device stays owned by its author and is not "new" again', async () => {
    await SyncManager.handlePush({ deviceId: 'A', timestamp: 1, chats: [mobileThread([{ id: '100', role: 'user', text: 'hi', timestamp: 1 }])] });
    const before = db.prepare(`SELECT received_at FROM direct_chats`).get();

    await SyncManager.handlePush({ deviceId: 'B', timestamp: 2, chats: [mobileThread([{ id: 't1:100', role: 'user', text: 'hi', timestamp: 1 }])] });

    expect(count(`SELECT COUNT(*) AS c FROM direct_chats`)).toBe(1);
    expect(db.prepare(`SELECT device_id FROM direct_chats`).get()).toEqual({ device_id: 'A' });
    expect(db.prepare(`SELECT received_at FROM direct_chats`).get()).toEqual(before);
  });

  it('merges memories on device + local id and reports the ones that failed', async () => {
    mocks.upsertMemory.mockResolvedValueOnce('kg-1').mockRejectedValueOnce(new Error('neo4j down'));
    const result = await SyncManager.handlePush({ deviceId: 'A', timestamp: 1, memories: [
      { id: 'mem1', content: 'likes tea', embedding: [0.1, 0.2] },
      { id: 'mem2', content: 'lives in Rome', embedding: [0.3] },
    ] });

    expect(mocks.upsertMemory).toHaveBeenCalledWith('likes tea', [0.1, 0.2], 'mobile_sync', 'A', 'A:mem1');
    expect(result.failedMemoryIds).toEqual(['mem2']);
  });
});

describe('meeting notes', () => {
  const notes = {
    title: 'Budget review',
    bookmarks_json: '[{"id":"bm_1","ms":1000}]',
    analysis_json: '{"title":"Budget","summary":"s"}',
    questions_json: null,
  };

  it('travel with the meeting to the other devices', async () => {
    await SyncManager.handlePush({ deviceId: 'A', timestamp: 1, meetings: [{ ...meeting, ...notes }] });
    const [pulled] = (await SyncManager.handlePull('B', 0)).meetings!;
    expect(pulled).toMatchObject(notes);
  });

  it('are kept when an app version without notes pushes the meeting', async () => {
    await SyncManager.handlePush({ deviceId: 'A', timestamp: 1, meetings: [{ ...meeting, ...notes }] });
    await SyncManager.handlePush({ deviceId: 'B', timestamp: 2, meetings: [{ ...meeting, duration: 75 }] });
    expect(db.prepare(`SELECT duration, title, bookmarks_json FROM meetings WHERE id = 'm1'`).get())
      .toEqual({ duration: 75, title: 'Budget review', bookmarks_json: notes.bookmarks_json });
  });

  it('are cleared when a device sends them empty, and ignored when malformed', async () => {
    await SyncManager.handlePush({ deviceId: 'A', timestamp: 1, meetings: [{ ...meeting, ...notes }] });
    await SyncManager.handlePush({ deviceId: 'A', timestamp: 2, meetings: [{ ...meeting, title: null, analysis_json: 42 }] });
    expect(db.prepare(`SELECT title, analysis_json FROM meetings WHERE id = 'm1'`).get())
      .toEqual({ title: null, analysis_json: notes.analysis_json });
  });
});

describe('sync pull', () => {
  it('uses the server clock as cursor and returns conversation titles', async () => {
    vi.useFakeTimers({ now: 1_000_000, toFake: ['Date'] });
    await SyncManager.handlePush({ deviceId: 'A', timestamp: 1, meetings: [meeting], chats: [
      // The phone clock is far behind: it must not matter
      mobileThread([{ id: '100', role: 'user', text: 'hi', timestamp: '2001-01-01T00:00:00.000Z' }]),
    ] });

    vi.setSystemTime(1_000_100);
    const first = await SyncManager.handlePull('B', 0);
    expect(first.chats).toHaveLength(1);
    expect(first.meetings).toHaveLength(1);
    expect(first.conversations).toEqual([expect.objectContaining({ id: 't1', title: 'Trip' })]);

    const again = await SyncManager.handlePull('B', first.timestamp);
    expect(again.chats).toEqual([]);
    expect(again.meetings).toEqual([]);

    const own = await SyncManager.handlePull('A', 0);
    expect(own.chats).toEqual([]); // a device never pulls its own data back
    vi.useRealTimers();
  });

  it('never loses a row written in the same millisecond as the pull', async () => {
    vi.useFakeTimers({ now: 2_000_000, toFake: ['Date'] });
    const pull = await SyncManager.handlePull('B', 0);
    await SyncManager.handlePush({ deviceId: 'A', timestamp: 1, chats: [mobileThread([{ id: '1', role: 'user', text: 'x', timestamp: 1 }])] });

    expect((await SyncManager.handlePull('B', pull.timestamp)).chats).toHaveLength(1);
    vi.useRealTimers();
  });
});

describe('sync deletions (tombstones)', () => {
  beforeEach(() => db.exec(`DELETE FROM sync_tombstones`));

  it('a deleted meeting disappears with its segments and reaches the other devices only', async () => {
    await SyncManager.handlePush({ deviceId: 'A', timestamp: 1, meetings: [meeting], meetingSegments: [segment('s1', 'hi')] });
    await SyncManager.handlePush({ deviceId: 'A', timestamp: 2, deletions: [{ type: 'meeting', id: 'm1', deletedAt: 5 }] });

    expect(count(`SELECT COUNT(*) AS c FROM meetings`)).toBe(0);
    expect(count(`SELECT COUNT(*) AS c FROM meeting_segments`)).toBe(0);
    expect((await SyncManager.handlePull('B', 0)).deletions).toEqual([{ type: 'meeting', id: 'm1', deletedAt: 5 }]);
    expect((await SyncManager.handlePull('A', 0)).deletions).toEqual([]);
  });

  it('a device that has not pulled the deletion yet cannot bring the meeting back', async () => {
    await SyncManager.handlePush({ deviceId: 'A', timestamp: 1, meetings: [meeting] });
    await SyncManager.handlePush({ deviceId: 'A', timestamp: 2, deletions: [{ type: 'meeting', id: 'm1', deletedAt: 5 }] });
    await SyncManager.handlePush({ deviceId: 'B', timestamp: 3, meetings: [meeting], meetingSegments: [segment('s1', 'old')] });

    expect(count(`SELECT COUNT(*) AS c FROM meetings`)).toBe(0);
    expect(count(`SELECT COUNT(*) AS c FROM meeting_segments`)).toBe(0);
  });

  it('a segment removed by a re-save is deleted and its meeting is pulled again', async () => {
    await SyncManager.handlePush({ deviceId: 'A', timestamp: 1, meetings: [meeting], meetingSegments: [segment('s1', 'a'), { ...segment('s2', 'b'), sequence: 2 }] });
    await SyncManager.handlePush({ deviceId: 'A', timestamp: 2, deletions: [{ type: 'segment', id: 's2', deletedAt: 7 }] });

    expect(db.prepare(`SELECT id FROM meeting_segments`).all()).toEqual([{ id: 's1' }]);
    const pull = await SyncManager.handlePull('B', 0);
    expect(pull.deletions).toEqual([{ type: 'segment', id: 's2', deletedAt: 7 }]);
  });

  it('ignores malformed deletions instead of failing the push', async () => {
    await SyncManager.handlePush({ deviceId: 'A', timestamp: 1, meetings: [meeting], deletions: [{ type: 'calendar', id: 'x' } as any, null as any, { type: 'meeting', id: '' } as any] });
    expect(count(`SELECT COUNT(*) AS c FROM meetings`)).toBe(1);
    expect(count(`SELECT COUNT(*) AS c FROM sync_tombstones`)).toBe(0);
  });
});
