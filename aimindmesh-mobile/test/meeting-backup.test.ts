import { beforeEach, describe, expect, it, vi } from 'vitest';

const backupPlugin = vi.hoisted(() => ({
  pickArchive: vi.fn(async () => ({ dataPath: '/cache/backup/meetings.json', dir: '/cache/backup' })),
  restoreAudio: vi.fn(async () => ({ restored: true })),
  cleanup: vi.fn(async () => { }),
  createArchive: vi.fn()
}));
const files = vi.hoisted(() => ({ backupJson: '' }));
const storage = vi.hoisted(() => ({
  saveMeeting: vi.fn(async () => { }),
  getAudioPath: (id: string) => `meeting-audio/${id}.audio`
}));
const records = vi.hoisted(() => ({ listMeetings: vi.fn(async () => [{ id: 'present' }]), loadMeeting: vi.fn() }));
const voices = vi.hoisted(() => ({
  listVoiceProfiles: vi.fn(async () => [] as any[]),
  saveVoiceProfile: vi.fn(async () => { }),
  saveMeetingVoices: vi.fn(async () => { }),
  loadMeetingVoices: vi.fn()
}));
const meetingDb = vi.hoisted(() => ({
  hasSyncDeletion: vi.fn(async (_type: string, id: string) => id === 'tombstoned'),
  attachRecoveredAudio: vi.fn(async () => { })
}));
const capture = vi.hoisted(() => ({ active: false }));

vi.mock('@capacitor/core', () => ({ registerPlugin: () => backupPlugin }));
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: { readFile: vi.fn(async () => ({ data: files.backupJson })) },
  Directory: { Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' }
}));
vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('../src/services/meeting/meetingStorage', () => storage);
vi.mock('../src/services/meeting/meetingRecords', () => records);
vi.mock('../src/services/speaker/voiceStorage', () => voices);
vi.mock('../src/services/meeting/meetingDeletions', () => ({ isMeetingDeleted: (id: string) => id === 'deleted-here' }));
vi.mock('../src/services/database/meetingDatabase', () => ({ MeetingDatabase: { getInstance: () => meetingDb } }));
vi.mock('../src/services/meeting/meetingExportPlugin', () => ({ meetingExportPlugin: {} }));
vi.mock('../src/services/meeting/meetingCapture', () => ({ isMeetingCaptureActive: () => capture.active }));

import { parseBackup, profilesToAdd, restoreFromBackup } from '../src/services/meeting/backup';

const FORMAT = 'meeting-assistant-backup';
const voice = (id: string, name: string) => ({ id, name, embedding: [1, 0], meetings: 1, updatedAt: 0 });
const meeting = (id: string, hasAudio = false) => ({
  id, timestamp: 1_700_000_000_000, duration: 60, transcript: [], speakerNames: {}, hasAudio
});

describe('parseBackup', () => {
  it('reads a backup of this version (also the standalone app\'s)', () => {
    const data = parseBackup(JSON.stringify({ format: FORMAT, version: 1, createdAt: 1, meetings: [] }));
    expect(data.voiceProfiles).toEqual([]);
  });

  it('refuses other files and newer versions', () => {
    expect(() => parseBackup('{"meetings": []}')).toThrow('not a meetings backup');
    expect(() => parseBackup(JSON.stringify({ format: FORMAT, version: 2, meetings: [] }))).toThrow('newer version');
  });
});

describe('profilesToAdd', () => {
  it('adds only voices whose name is not known yet, without reusing an id', () => {
    const added = profilesToAdd(
      [voice('a', 'Marco'), voice('b', 'giulia'), voice('c', 'Anna'), { id: 'x' } as any],
      [voice('c', 'Giulia')]
    );
    expect(added.map(p => p.name)).toEqual(['Marco', 'Anna']);
    expect(added[1].id).toBe('c_restored');
  });

  it('never restores the owner voice: it is enrolled on each phone', () => {
    expect(profilesToAdd([voice('voice_owner', 'Luca'), voice('a', 'Marco')], [])).toEqual([voice('a', 'Marco')]);
  });
});

describe('restoreFromBackup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capture.active = false;
  });

  it('skips meetings already present, deleted here or tombstoned by the sync', async () => {
    files.backupJson = JSON.stringify({
      format: FORMAT, version: 1, createdAt: 1,
      meetings: [meeting('present'), meeting('deleted-here'), meeting('tombstoned'), { ...meeting('new', true), title: 'Kickoff' }],
      voiceProfiles: [voice('v1', 'Marco')]
    });

    const summary = await restoreFromBackup(() => { });

    expect(summary).toEqual({ added: 1, skipped: 3, recordings: 1, voices: 1 });
    expect(storage.saveMeeting).toHaveBeenCalledTimes(1);
    expect(storage.saveMeeting).toHaveBeenCalledWith(expect.objectContaining({ id: 'new', title: 'Kickoff', hasAudio: false }));
    // The recording is attached afterwards, so the audio flag never goes backwards
    expect(meetingDb.attachRecoveredAudio).toHaveBeenCalledWith(expect.objectContaining({ id: 'new', audioPath: 'meeting-audio/new.audio' }));
    expect(backupPlugin.cleanup).toHaveBeenCalled();
  });

  it('refuses to run while a meeting is recording', async () => {
    capture.active = true;
    await expect(restoreFromBackup(() => { })).rejects.toThrow('Stop the meeting recording');
    expect(backupPlugin.pickArchive).not.toHaveBeenCalled();
  });

  it('cleans the extracted files up even when the backup is unreadable', async () => {
    files.backupJson = '{"meetings": []}';
    await expect(restoreFromBackup(() => { })).rejects.toThrow('not a meetings backup');
    expect(backupPlugin.cleanup).toHaveBeenCalled();
  });
});
