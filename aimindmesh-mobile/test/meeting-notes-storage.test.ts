import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  executeSet: vi.fn(async (_set: any[], _transaction?: boolean) => ({})),
  execute: vi.fn(async () => ({})),
  query: vi.fn(async (_sql: string, _values?: any[]) => ({ values: [] as any[] })),
  run: vi.fn(async (_sql: string, _values?: any[]) => ({}))
}));

vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { convertFileSrc: (p: string) => p, getPlatform: () => 'web', isNativePlatform: () => false },
  registerPlugin: () => ({})
}));
vi.mock('../src/utils/fileSystemAdapter', () => ({
  FileSystemAdapter: { getUri: async ({ path }: { path: string }) => ({ uri: `file:///files/${path}` }) },
  Directory: { Data: 'DATA' },
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
  buildMarkMeetingAudioStatement,
  buildMeetingSaveSet,
  buildSearchSegmentsQuery,
  buildUpdateNotesStatement,
  buildUpdateVoicesStatement,
  DBMeeting,
  likePattern
} from '../src/services/database/meetingStatements';
import { saveMeeting } from '../src/services/meeting/meetingStorage';
import { attachRecordingToMeeting, updateMeetingNotes } from '../src/services/meeting/meetingRecords';
import { SavedMeeting } from '../src/types/meeting';

const row: DBMeeting = {
  id: 'm1', timestamp: 1, duration: 60, has_audio: true, audio_file_path: 'meeting-audio/m1.audio',
  audio_mime_type: 'audio/mp4', speaker_names_json: '{}'
};
const placeholders = (sql: string) => (sql.match(/\?/g) || []).length;
const sqlOf = (set: { statement?: string }[]) => set.map(s => s.statement ?? '').join('\n');

beforeEach(() => vi.clearAllMocks());

describe('notes in the meeting save', () => {
  it('a save that does not carry notes never writes the notes columns', () => {
    expect(sqlOf(buildMeetingSaveSet(row, []))).not.toMatch(/title|bookmarks_json|analysis_json|questions_json/);
  });

  it('a save with notes writes them in the same transaction and marks the meeting for sync', () => {
    const set = buildMeetingSaveSet({ ...row, title: 'Budget', bookmarks_json: null }, []);
    const update = set.find(s => s.statement?.startsWith('UPDATE meetings'))!;
    expect(update.statement).toBe('UPDATE meetings SET title = ?, bookmarks_json = ?, is_synced = 0 WHERE id = ?');
    expect(update.values).toEqual(['Budget', null, 'm1']);
  });

  it('indexes segment text for search without accents', () => {
    const set = buildMeetingSaveSet(row, [{
      id: 's1', meeting_id: 'm1', sequence: 0, start_ms: 0, end_ms: 1, text: 'Perché NO', speaker_id: 0,
      stt_provider: null, confidence: null, words_json: null, original_text: null, is_edited: false, edited_at: null
    }]);
    const insert = set.find(s => s.statement?.includes('INSERT INTO meeting_segments'))!;
    expect(insert.values![insert.values!.length - 1]).toBe('perche no');
    for (const s of set) expect(s.values ?? []).toHaveLength(placeholders(s.statement!));
  });

  it('saveMeeting passes on only the notes it was given', async () => {
    const meeting: SavedMeeting = { id: 'm1', timestamp: 1, duration: 60, hasAudio: false, speakerNames: {}, transcript: [] };
    await saveMeeting(meeting);
    expect(sqlOf(db.executeSet.mock.calls[0][0])).not.toMatch(/UPDATE meetings SET/);

    await saveMeeting({ ...meeting, title: ' Weekly ', questions: [] });
    const update = db.executeSet.mock.calls[1][0].find((s: any) => s.statement.startsWith('UPDATE meetings'));
    expect(update.values).toEqual(['Weekly', null, 'm1']);
  });
});

describe('partial updates', () => {
  it('note edits are pushed, voices stay local', () => {
    expect(buildUpdateNotesStatement('m1', { analysis_json: '{}' })!.statement).toContain('is_synced = 0');
    expect(buildUpdateNotesStatement('m1', {})).toBeNull();
    expect(buildUpdateVoicesStatement('m1', '[]').statement).not.toContain('is_synced');
  });

  it('attaching a recording keeps the transcript, start time and notes', () => {
    const { statement, values } = buildMarkMeetingAudioStatement({
      meetingId: 'm1', startedAt: 5, durationSec: 61.5, audioFilePath: 'meeting-audio/m1.audio', mimeType: 'audio/mp4'
    });
    const update = statement.split('DO UPDATE SET')[1];
    expect(update).not.toMatch(/timestamp|speaker_names_json|title|meeting_segments/);
    expect(values).toHaveLength(placeholders(statement));
  });

  it('bookmarks marked during the recording are merged into the saved ones', async () => {
    db.query.mockImplementation(async (sql: string) => sql.startsWith('SELECT * FROM meetings')
      ? { values: [{ ...row, has_audio: 1, bookmarks_json: '[{"id":"a","ms":60000}]' }] }
      : { values: [] });
    const meeting = await attachRecordingToMeeting({
      meetingId: 'm1', startedAt: 1, durationMs: 90_000, mimeType: 'audio/mp4',
      bookmarks: [{ id: 'b', ms: 10_000 }, { id: 'c', ms: 60_500 }]
    });
    expect(meeting!.bookmarks!.map(b => b.ms)).toEqual([10_000, 60_000]);
    const update = db.run.mock.calls.find(([sql]) => sql.startsWith('UPDATE meetings SET bookmarks_json'))!;
    expect(JSON.parse(update[1]![0])).toHaveLength(2);
    db.query.mockReset().mockResolvedValue({ values: [] });
  });

  it('a notes update with nothing to change writes nothing', async () => {
    await updateMeetingNotes('m1', {});
    expect(db.run).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE meetings'), expect.anything());
  });
});

describe('search query', () => {
  it('searches normalized text with LIKE wildcards escaped', () => {
    expect(likePattern('50%_off')).toBe('%50\\%\\_off%');
    const { statement, values } = buildSearchSegmentsQuery('  Città ');
    expect(statement).toContain("search_text LIKE ? ESCAPE '\\'");
    expect(values[0]).toBe('%citta%');
    expect(values).toHaveLength(placeholders(statement));
  });
});
