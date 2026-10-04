/**
 * Backup of every meeting (transcripts, notes, speaker names and voices, recordings) and of the
 * known voices, in one zip archive the user saves wherever they like, and restore from it.
 */

import { registerPlugin } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { SavedMeeting } from '../../types/meeting';
import { logger } from '../logger';
import { MeetingVoices, OWNER_VOICE_ID, VoiceProfile } from '../speaker/voiceProfiles';
import { listVoiceProfiles, loadMeetingVoices, saveMeetingVoices, saveVoiceProfile } from '../speaker/voiceStorage';
import { listMeetings, loadMeeting } from './meetingRecords';
import { getAudioPath, saveMeeting } from './meetingStorage';
import { isMeetingDeleted } from './meetingDeletions';
import { MeetingDatabase } from '../database/meetingDatabase';
import { meetingExportPlugin } from './meetingExportPlugin';
import { isMeetingCaptureActive } from './meetingCapture';

interface BackupPluginApi {
    createArchive(options: { dataPath: string; meetingIds: string[] }): Promise<{ path: string; bytes: number; audioFiles: number }>;
    pickArchive(): Promise<{ cancelled?: boolean; dir?: string; dataPath?: string; audioFiles?: number }>;
    restoreAudio(options: { meetingId: string }): Promise<{ restored: boolean }>;
    cleanup(): Promise<void>;
}

const Backup = registerPlugin<BackupPluginApi>('Backup');

const FORMAT = 'meeting-assistant-backup';

export interface BackupData {
    format: typeof FORMAT;
    version: 1;
    createdAt: number;
    meetings: Array<SavedMeeting & { voices?: MeetingVoices }>;
    voiceProfiles: VoiceProfile[];
}

export interface RestoreSummary {
    added: number;
    /** Meetings already on the phone, left as they are. */
    skipped: number;
    recordings: number;
    voices: number;
}

/** Checks that parsed JSON is a backup this version can read. */
export function parseBackup(json: string): BackupData {
    const data = JSON.parse(json);
    if (data?.format !== FORMAT || !Array.isArray(data.meetings)) {
        throw new Error('This file is not a meetings backup (AI Mind Mesh or Meeting Assistant)');
    }
    if (data.version > 1) {
        throw new Error('This backup was made by a newer version of the app: update the app first');
    }
    return { ...data, voiceProfiles: Array.isArray(data.voiceProfiles) ? data.voiceProfiles : [] };
}

/**
 * The known voices to add from a backup: those whose name isn't known yet. The owner's voice
 * is not restored: it is enrolled on each phone (Settings → Speaker), where it also drives the
 * live "you" label.
 */
export function profilesToAdd(backup: VoiceProfile[], existing: VoiceProfile[]): VoiceProfile[] {
    const names = new Set(existing.map(p => p.name.toLocaleLowerCase()));
    const ids = new Set(existing.map(p => p.id));
    return backup
        .filter(p => p?.name && Array.isArray(p.embedding) && p.id !== OWNER_VOICE_ID && !names.has(p.name.toLocaleLowerCase()))
        .map(p => (ids.has(p.id) ? { ...p, id: `${p.id}_restored` } : p));
}

/** Writes the backup archive and opens the share sheet to save it. */
export async function exportAllMeetings(onProgress: (message: string) => void): Promise<{ meetings: number; recordings: number; bytes: number }> {
    const summaries = await listMeetings();
    const meetings: BackupData['meetings'] = [];
    for (const [i, summary] of summaries.entries()) {
        onProgress(`Reading meeting ${i + 1} of ${summaries.length}`);
        const meeting = await loadMeeting(summary.id);
        if (!meeting) continue;
        const voices = await loadMeetingVoices(summary.id);
        meetings.push(Object.keys(voices).length ? { ...meeting, voices } : meeting);
    }
    const data: BackupData = { format: FORMAT, version: 1, createdAt: Date.now(), meetings, voiceProfiles: await listVoiceProfiles() };

    onProgress('Writing the archive (recordings included)');
    await Filesystem.writeFile({ path: 'backup-data.json', directory: Directory.Cache, data: JSON.stringify(data), encoding: Encoding.UTF8 });
    const { uri } = await Filesystem.getUri({ path: 'backup-data.json', directory: Directory.Cache });
    try {
        const archive = await Backup.createArchive({
            dataPath: uri,
            meetingIds: meetings.filter(m => m.hasAudio).map(m => m.id)
        });
        onProgress('Choose where to save the backup');
        await meetingExportPlugin.shareFile(archive.path, 'application/zip', 'Save the meetings backup');
        return { meetings: meetings.length, recordings: archive.audioFiles, bytes: archive.bytes };
    } finally {
        await Filesystem.deleteFile({ path: 'backup-data.json', directory: Directory.Cache }).catch(() => { });
    }
}

/**
 * Lets the user pick a backup and adds the meetings and voices the phone doesn't have yet.
 * Meetings deleted here (or on another device) are not brought back. Restored meetings are
 * pushed to the AIMindMesh server at the next sync. The format is the Meeting Assistant app's:
 * backups go both ways.
 */
export async function restoreFromBackup(onProgress: (message: string) => void): Promise<RestoreSummary | null> {
    if (isMeetingCaptureActive()) throw new Error('Stop the meeting recording before restoring a backup');
    onProgress('Choose the backup file');
    const picked = await Backup.pickArchive();
    if (picked.cancelled || !picked.dataPath) return null;
    try {
        onProgress('Reading the backup');
        const { data } = await Filesystem.readFile({ path: `file://${picked.dataPath}`, encoding: Encoding.UTF8 });
        const backup = parseBackup(data as string);
        const existing = new Set((await listMeetings()).map(m => m.id));
        const summary: RestoreSummary = { added: 0, skipped: 0, recordings: 0, voices: 0 };

        for (const [i, meeting] of backup.meetings.entries()) {
            onProgress(`Restoring meeting ${i + 1} of ${backup.meetings.length}`);
            if (existing.has(meeting.id) || isMeetingDeleted(meeting.id)
                || await MeetingDatabase.getInstance().hasSyncDeletion('meeting', meeting.id)) {
                summary.skipped++;
                continue;
            }
            const { restored } = meeting.hasAudio ? await Backup.restoreAudio({ meetingId: meeting.id }) : { restored: false };
            await saveMeeting({
                id: meeting.id,
                timestamp: meeting.timestamp,
                duration: meeting.duration,
                transcript: meeting.transcript ?? [],
                speakerNames: meeting.speakerNames ?? {},
                hasAudio: false,
                title: meeting.title ?? '',
                bookmarks: meeting.bookmarks ?? [],
                analysis: meeting.analysis ?? null,
                questions: meeting.questions ?? []
            });
            if (restored) {
                await MeetingDatabase.getInstance().attachRecoveredAudio({
                    id: meeting.id,
                    timestamp: meeting.timestamp,
                    durationSec: meeting.duration,
                    audioPath: getAudioPath(meeting.id),
                    mimeType: meeting.audioMimeType || 'audio/mp4'
                });
            }
            if (meeting.voices && Object.keys(meeting.voices).length) await saveMeetingVoices(meeting.id, meeting.voices);
            summary.added++;
            if (restored) summary.recordings++;
        }

        for (const profile of profilesToAdd(backup.voiceProfiles, await listVoiceProfiles())) {
            await saveVoiceProfile(profile);
            summary.voices++;
        }
        logger.log('info', `Backup restored: ${summary.added} meetings added, ${summary.skipped} already present`);
        return summary;
    } finally {
        await Backup.cleanup().catch(() => { });
    }
}
