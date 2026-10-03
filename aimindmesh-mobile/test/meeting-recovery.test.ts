import { beforeEach, describe, expect, it, vi } from 'vitest';

const converter = vi.hoisted(() => ({
  listOrphanRecordings: vi.fn(async () => ({ recordings: [] as any[] })),
  recoverRecording: vi.fn(async ({ path }: { path: string }) => ({ filePath: `/data/user/0/app/files/meeting_recording_${path.length}.m4a`, durationMs: 720000 })),
  discardRecording: vi.fn(async () => { })
}));
const fs = vi.hoisted(() => ({
  rename: vi.fn(async () => { }),
  copy: vi.fn(async () => { }),
  mkdir: vi.fn(async () => { }),
  deleteFile: vi.fn(async () => { }),
  getUri: vi.fn(async ({ path }: { path: string }) => ({ uri: `file:///data/user/0/app/files/${path}` }))
}));
const db = vi.hoisted(() => ({
  executeSet: vi.fn(async () => ({})),
  execute: vi.fn(async () => ({})),
  query: vi.fn(async (_sql: string, _values?: any[]) => ({ values: [] as any[] })),
  run: vi.fn(async (_sql: string, _values?: any[]) => ({}))
}));

vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { convertFileSrc: (p: string) => p, getPlatform: () => 'android', isNativePlatform: () => true },
  registerPlugin: () => ({})
}));
vi.mock('../src/services/audio/audioConverter', () => ({ default: converter }));
vi.mock('../src/utils/fileSystemAdapter', () => ({
  FileSystemAdapter: fs,
  Directory: { Data: 'DATA', Documents: 'DOCUMENTS', Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' }
}));
vi.mock('../src/services/database/DatabaseManager', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getDatabase: async () => db,
      serializedWrite: async (_type: string, op: (d: typeof db) => Promise<unknown>) => op(db)
    })
  }
}));

import { describeRecoveredRecording, recoverInterruptedRecordings } from '../src/services/meeting/recordingRecovery';

const orphan = (meetingId: string, durationMs = 720000) => ({
  path: `/data/user/0/app/files/meeting-pcm/rec_1000_${meetingId || 'none'}_16000_1.pcm`,
  meetingId, startedAt: 1_700_000_000_000, durationMs, sampleRate: 16000, channels: 1
});

let existingMeetings = new Set<string>();
let tombstones = new Set<string>();

beforeEach(() => {
  vi.clearAllMocks();
  existingMeetings = new Set();
  tombstones = new Set();
  db.query.mockImplementation(async (sql: string, values?: any[]) => {
    if (sql.includes('FROM meetings WHERE id')) return { values: existingMeetings.has(values![0]) ? [{ id: values![0], has_audio: 0 }] : [] };
    if (sql.includes('FROM sync_deletions WHERE')) return { values: tombstones.has(values![1]) ? [{ 1: 1 }] : [] };
    return { values: [] };
  });
  db.run.mockImplementation(async (_sql: string, values?: any[]) => {
    existingMeetings.add(values![0]);
    return {};
  });
});

describe('recovery of interrupted recordings', () => {
  it('attaches the audio to the checkpointed meeting', async () => {
    existingMeetings.add('m-checkpoint');
    converter.listOrphanRecordings.mockResolvedValueOnce({ recordings: [orphan('m-checkpoint')] });

    const recovered = await recoverInterruptedRecordings();

    expect(recovered).toEqual([{ meetingId: 'm-checkpoint', startedAt: 1_700_000_000_000, durationMs: 720000, created: false }]);
    expect(fs.rename).toHaveBeenCalledWith(expect.objectContaining({ to: 'meeting-audio/m-checkpoint.audio' }));
    const [sql, values] = db.run.mock.calls[0];
    expect(sql).toContain('ON CONFLICT(id) DO UPDATE');
    expect(values).toEqual(['m-checkpoint', 1_700_000_000_000, 720, 'meeting-audio/m-checkpoint.audio', 'audio/mp4']);
  });

  it('creates the meeting when no checkpoint exists, and a new one for deleted meetings', async () => {
    tombstones.add('m-deleted');
    converter.listOrphanRecordings.mockResolvedValueOnce({ recordings: [orphan('m-new'), orphan('m-deleted'), orphan('')] });

    const recovered = await recoverInterruptedRecordings();

    expect(recovered.map(r => [r.meetingId, r.created])).toEqual([
      ['m-new', true],
      ['recovered_1700000000000', true],
      ['recovered_1700000000000_2', true] // never merged into another recovered meeting
    ]);
  });

  it('discards empty recordings and keeps the PCM when encoding fails', async () => {
    converter.listOrphanRecordings.mockResolvedValueOnce({ recordings: [orphan('m-empty', 200), orphan('m-fail'), orphan('m-ok')] });
    converter.recoverRecording
      .mockRejectedValueOnce(new Error('encoder'))
      .mockResolvedValueOnce({ filePath: '/data/user/0/app/files/meeting_recording9.wav', durationMs: 30000 });

    const recovered = await recoverInterruptedRecordings();

    expect(converter.discardRecording).toHaveBeenCalledWith({ path: orphan('m-empty').path });
    // The failed one is not discarded: the native side keeps its PCM for the next start
    expect(converter.discardRecording).toHaveBeenCalledTimes(1);
    expect(recovered.map(r => r.meetingId)).toEqual(['m-ok']);
    expect(db.run.mock.calls[0][1]![4]).toBe('audio/wav');
  });

  it('shares one run between concurrent callers', async () => {
    converter.listOrphanRecordings.mockResolvedValueOnce({ recordings: [orphan('m-once')] });
    const [a, b] = await Promise.all([recoverInterruptedRecordings(), recoverInterruptedRecordings()]);
    expect(a).toBe(b);
    expect(converter.recoverRecording).toHaveBeenCalledTimes(1);
  });

  it('describes the recovery with the time the recording was interrupted', () => {
    const text = describeRecoveredRecording({ meetingId: 'm', startedAt: 1_700_000_000_000, durationMs: 720000, created: false }, 'en-GB');
    const expectedTime = new Date(1_700_000_000_000 + 720000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    expect(text).toBe(`Recording interrupted at ${expectedTime} recovered (12 min)`);
    expect(describeRecoveredRecording({ meetingId: 'm', startedAt: 0, durationMs: 42000, created: true }, 'en-GB')).toMatch(/\(42 s\)$/);
  });
});
