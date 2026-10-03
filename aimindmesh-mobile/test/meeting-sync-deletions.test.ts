import { beforeEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({
  rename: vi.fn(async () => { }),
  copy: vi.fn(async () => { }),
  mkdir: vi.fn(async () => { }),
  deleteFile: vi.fn(async () => { }),
  writeFile: vi.fn(async () => { }),
  stat: vi.fn(async () => ({ size: 10 })),
  readFile: vi.fn(async () => ({ data: '' })),
  getUri: vi.fn(async ({ path }: { path: string }) => ({ uri: `file:///data/user/0/app/files/${path}` }))
}));
const db = vi.hoisted(() => ({
  executeSet: vi.fn(async (_set: any[], _transaction?: boolean) => ({})),
  execute: vi.fn(async () => ({})),
  query: vi.fn(async (_sql: string, _values?: any[]) => ({ values: [] as any[] })),
  run: vi.fn(async () => ({}))
}));

vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { convertFileSrc: (p: string) => p, getPlatform: () => 'web', isNativePlatform: () => false },
  registerPlugin: () => ({})
}));
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

import {
  applyRemoteDeletions,
  buildMeetingDeleteSet,
  buildMeetingSaveSet,
  buildRemoteDeletionSet,
  clearSyncDeletions,
  getPendingSyncDeletions,
  MeetingDatabase
} from '../src/services/database/meetingDatabase';
import { deleteMeeting, saveMeeting } from '../src/services/meeting/meetingStorage';
import { isMeetingDeleted, MeetingDeletedError, onMeetingDeleted, onSegmentsDeleted } from '../src/services/meeting/meetingDeletions';
import { SavedMeeting } from '../src/types/meeting';

const meeting = (id: string): SavedMeeting => ({
  id, timestamp: 1, duration: 1, hasAudio: false, speakerNames: {},
  transcript: [{ id: `${id}-s1`, speakerId: 0, text: 'x', timestamp: 0 }]
});

beforeEach(() => {
  vi.clearAllMocks();
  db.query.mockImplementation(async () => ({ values: [] }));
});

describe('tombstone statements', () => {
  it('tombstones the segments a save drops, in the save transaction', () => {
    const set = buildMeetingSaveSet(
      { id: 'm', timestamp: 1, duration: 0, has_audio: false, audio_file_path: null, audio_mime_type: null, speaker_names_json: '{}' },
      [], 42
    );
    expect(set[1].statement).toMatch(/INSERT OR REPLACE INTO sync_deletions[\s\S]*SELECT 'segment', id, \? FROM meeting_segments WHERE meeting_id = \?/);
    expect(set[1].values).toEqual([42, 'm']);
    expect(set[2].statement).toBe('DELETE FROM meeting_segments WHERE meeting_id = ?');
    // Segments written again lose their tombstone
    expect(set[set.length - 1].statement).toMatch(/DELETE FROM sync_deletions WHERE entity_type = 'segment'[\s\S]*meeting_id = \?/);
  });

  it('records the meeting tombstone with the delete', () => {
    const set = buildMeetingDeleteSet('m', 7);
    expect(set[0]).toEqual({
      statement: "INSERT OR REPLACE INTO sync_deletions (entity_type, entity_id, deleted_at) VALUES ('meeting', ?, ?)",
      values: ['m', 7]
    });
    expect(set.map(s => s.statement)).toContain('DELETE FROM meetings WHERE id = ?');
  });

  it('applies remote deletions without writing tombstones', () => {
    const set = buildRemoteDeletionSet(['m'], ['s']);
    expect(set.some(s => /INSERT/.test(s.statement!))).toBe(false);
    expect(set.map(s => [s.statement, s.values])).toContainEqual(['DELETE FROM meeting_segments WHERE id = ?', ['s']]);
  });
});

describe('sync deletion API', () => {
  it('lists and clears pending deletions', async () => {
    db.query.mockImplementation(async (sql: string) => sql.includes('FROM sync_deletions')
      ? { values: [{ entity_type: 'meeting', entity_id: 'm1', deleted_at: 5 }, { entity_type: 'segment', entity_id: 's1', deleted_at: 6 }] }
      : { values: [] });
    expect(await getPendingSyncDeletions()).toEqual([
      { type: 'meeting', id: 'm1', deletedAt: 5 },
      { type: 'segment', id: 's1', deletedAt: 6 }
    ]);

    await clearSyncDeletions([{ type: 'segment', id: 's1' }]);
    const [set, transaction] = db.executeSet.mock.calls[0];
    expect(transaction).toBe(true);
    expect(set).toEqual([{ statement: 'DELETE FROM sync_deletions WHERE entity_type = ? AND entity_id = ?', values: ['segment', 's1'] }]);
  });

  it('applies remote deletions: rows, audio file and listeners', async () => {
    const deletedMeetings: string[] = [];
    const deletedSegments: string[][] = [];
    const offMeeting = onMeetingDeleted(id => deletedMeetings.push(id));
    const offSegments = onSegmentsDeleted(ids => deletedSegments.push([...ids]));

    await applyRemoteDeletions([
      { type: 'meeting', id: 'remote-m', deletedAt: 1 },
      { type: 'segment', id: 'remote-s', deletedAt: 1 }
    ]);
    offMeeting();
    offSegments();

    expect(db.executeSet).toHaveBeenCalledTimes(1);
    expect(fs.deleteFile).toHaveBeenCalledWith({ path: 'meeting-audio/remote-m.audio', directory: 'DATA' });
    expect(deletedMeetings).toEqual(['remote-m']);
    expect(deletedSegments).toEqual([['remote-s']]);
    expect(isMeetingDeleted('remote-m')).toBe(true);
  });
});

describe('deleting the open meeting', () => {
  it('refuses later saves, so an autosave cannot recreate it', async () => {
    const heard: string[] = [];
    const off = onMeetingDeleted(id => heard.push(id));
    expect(await deleteMeeting('open-m')).toBe(true);
    off();
    expect(heard).toEqual(['open-m']);

    await expect(saveMeeting(meeting('open-m'), { filePath: '/data/user/0/app/files/meeting_recording1.m4a' }))
      .rejects.toBeInstanceOf(MeetingDeletedError);
    expect(fs.rename).not.toHaveBeenCalled();
    // Only the delete transaction reached the database
    expect(db.executeSet).toHaveBeenCalledTimes(1);
  });

  it('a save already queued is refused inside the write queue', async () => {
    const mdb = MeetingDatabase.getInstance();
    await deleteMeeting('queued-m');
    await expect(mdb.saveMeeting(
      { id: 'queued-m', timestamp: 1, duration: 0, has_audio: false, audio_file_path: null, audio_mime_type: null, speaker_names_json: '{}' },
      []
    )).rejects.toBeInstanceOf(MeetingDeletedError);
  });

  it('a failed delete lets the meeting be saved again', async () => {
    db.executeSet.mockRejectedValueOnce(new Error('disk'));
    expect(await deleteMeeting('kept-m')).toBe(false);
    expect(isMeetingDeleted('kept-m')).toBe(false);
    await saveMeeting(meeting('kept-m'));
    expect(db.executeSet).toHaveBeenCalledTimes(2);
  });
});
