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
  query: vi.fn(async () => ({ values: [] as any[] })),
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

import { buildMeetingSaveSet } from '../src/services/database/meetingDatabase';
import { saveMeeting, toDBSegments } from '../src/services/meeting/meetingStorage';
import { toSRT, toVTT, toHTMLForPDF, toMarkdown } from '../src/services/meeting/meetingExportService';
import { SavedMeeting } from '../src/types/meeting';

const meeting = (overrides: Partial<SavedMeeting> = {}): SavedMeeting => ({
  id: 'm1',
  timestamp: 1_000_000,
  duration: 65,
  hasAudio: false,
  speakerNames: { 0: 'Anna' },
  transcript: [
    { id: 's1', speakerId: 0, text: 'Hello', timestamp: 0, start_ms: 1000.4, end_ms: 2500 },
    { id: 's2', speakerId: 1, text: 'Hi', timestamp: 0 }
  ],
  ...overrides
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('meeting save statements', () => {
  it('upserts the meeting and replaces its segments in one set', () => {
    const set = buildMeetingSaveSet(
      { id: 'm1', timestamp: 1, duration: 0, has_audio: false, audio_file_path: null, audio_mime_type: null, speaker_names_json: '{}' },
      toDBSegments('m1', [
        { id: 'a', speakerId: 0, text: 'x', timestamp: 0 },
        { id: 'a', speakerId: 0, text: 'y', timestamp: 0 }
      ])
    );
    expect(set[0].statement).toContain('ON CONFLICT(id) DO UPDATE');
    expect(set[0].statement).toContain('COALESCE(excluded.audio_file_path, meetings.audio_file_path)');
    expect(set[0].statement).not.toContain('REPLACE');
    expect(set[2]).toEqual({ statement: 'DELETE FROM meeting_segments WHERE meeting_id = ?', values: ['m1'] });
    // A duplicated id would abort the transaction: it is made unique
    expect(set.slice(3, 5).map(s => s.values![0])).toEqual(['a', 'a_1']);
  });

  it('rounds segment times and keeps the order', () => {
    const rows = toDBSegments('m1', meeting().transcript);
    expect(rows.map(r => [r.id, r.sequence, r.start_ms, r.end_ms])).toEqual([['s1', 0, 1000, 2500], ['s2', 1, 0, 0]]);
  });
});

describe('saveMeeting', () => {
  it('moves the recording into meeting storage and saves in one transaction', async () => {
    const saved = await saveMeeting(meeting(), { filePath: '/data/user/0/app/files/meeting_recording123.m4a' });

    expect(fs.rename).toHaveBeenCalledWith(expect.objectContaining({
      from: 'meeting_recording123.m4a',
      to: 'meeting-audio/m1.audio'
    }));
    expect(fs.copy).not.toHaveBeenCalled();
    expect(db.executeSet).toHaveBeenCalledTimes(1);
    const [set, transaction] = db.executeSet.mock.calls[0];
    expect(transaction).toBe(true);
    expect(set[0].values).toEqual(['m1', 1_000_000, 65, 1, 'meeting-audio/m1.audio', 'audio/mp4', '{"0":"Anna"}']);
    expect(set).toHaveLength(6); // upsert, tombstones, delete, 2 segments, tombstone cleanup
    // No implicit deletion of other meetings (the old 50-meeting cap)
    expect(set.some((s: any) => /DELETE FROM meetings/.test(s.statement))).toBe(false);
    expect(saved.audioFilePath).toBe('/data/user/0/app/files/meeting-audio/m1.audio');
  });

  it('leaves the stored audio alone when saving the transcript only', async () => {
    await saveMeeting(meeting({ hasAudio: true, audioMimeType: 'audio/mp4' }));
    expect(fs.rename).not.toHaveBeenCalled();
    const [set] = db.executeSet.mock.calls[0];
    // null path: COALESCE keeps the stored one
    expect(set[0].values.slice(3, 6)).toEqual([1, null, 'audio/mp4']);
  });

  it('does not move a file that is already in place', async () => {
    await saveMeeting(meeting(), { filePath: 'file:///data/user/0/app/files/meeting-audio/m1.audio' });
    expect(fs.rename).not.toHaveBeenCalled();
    expect(fs.copy).not.toHaveBeenCalled();
  });

  it('copies when the move fails, then removes the temporary file', async () => {
    fs.rename.mockRejectedValueOnce(new Error('exists'));
    await saveMeeting(meeting(), { filePath: '/data/user/0/app/files/meeting_recording9.wav' });
    expect(fs.copy).toHaveBeenCalledTimes(1);
    expect(fs.deleteFile).toHaveBeenCalledWith(expect.objectContaining({ path: 'meeting_recording9.wav' }));
    const [set] = db.executeSet.mock.calls[0];
    expect(set[0].values[5]).toBe('audio/wav');
  });
});

describe('transcript exports', () => {
  it('gives untimed segments a visible cue instead of a zero-length one', () => {
    const srt = toSRT(meeting(), { includeSpeakerLabels: true, includeTimestamps: true, includeWordTimestamps: false });
    expect(srt).toContain('00:00:01,000 --> 00:00:02,500');
    expect(srt).toContain('00:00:00,000 --> 00:00:03,000');
    expect(srt).toContain('Anna: Hello');
    expect(srt).toContain('Speaker 2: Hi');
  });

  it('escapes user text in the PDF page and in VTT voices', () => {
    const m = meeting({ speakerNames: { 0: 'A<b>' }, transcript: [{ id: 's', speakerId: 0, text: '<script>x</script> & y', timestamp: 0 }] });
    const html = toHTMLForPDF(m, { includeSpeakerLabels: true, includeTimestamps: false, includeWordTimestamps: false });
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt; &amp; y');
    expect(html).not.toContain('<script>');
    expect(toVTT(m, { includeSpeakerLabels: true, includeTimestamps: true, includeWordTimestamps: false })).toContain('<v A b >');
  });

  it('formats the duration in seconds', () => {
    expect(toMarkdown(meeting())).toContain('**Duration:** 1m 5s');
  });
});
