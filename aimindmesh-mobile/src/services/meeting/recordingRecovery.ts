import { Capacitor } from '@capacitor/core';
import AudioConverter from '../audio/audioConverter';
import { logger } from '../logger';
import { MeetingDatabase } from '../database/meetingDatabase';
import { isMeetingDeleted } from './meetingDeletions';
import { storeMeetingAudioFile } from './meetingStorage';

/** A recording left on disk by an app killed while recording (native AudioConverter). */
export interface OrphanRecording {
    path: string;
    /** Empty when the recording was not tied to a meeting (older versions) */
    meetingId: string;
    startedAt: number;
    durationMs: number;
}

/** AudioConverter methods used by meetings (the native plugin implements them). */
export interface MeetingAudioConverter {
    startWriting(options: { sampleRate: number; channels: number; meetingId?: string; startedAt?: number }): Promise<void>;
    listOrphanRecordings(): Promise<{ recordings: OrphanRecording[] }>;
    recoverRecording(options: { path: string }): Promise<{ filePath: string; durationMs: number }>;
    discardRecording(options: { path: string }): Promise<void>;
}

export const meetingAudioConverter = AudioConverter as unknown as MeetingAudioConverter;

export interface RecoveredRecording {
    meetingId: string;
    startedAt: number;
    durationMs: number;
    /** No transcript checkpoint existed: the meeting was created for the audio */
    created: boolean;
}

/** Below this nothing worth keeping was recorded */
const MIN_RECOVERY_MS = 1000;

let running: Promise<RecoveredRecording[]> | null = null;

async function recoverOne(recording: OrphanRecording): Promise<RecoveredRecording | null> {
    if (recording.durationMs < MIN_RECOVERY_MS) {
        await meetingAudioConverter.discardRecording({ path: recording.path });
        return null;
    }

    const db = MeetingDatabase.getInstance();
    let meetingId = recording.meetingId;
    // A meeting deleted by the user gets the audio under a new id rather than coming back;
    // a new id never reuses an existing meeting (its audio would be overwritten)
    if (!meetingId || isMeetingDeleted(meetingId) || await db.hasSyncDeletion('meeting', meetingId)) {
        const base = `recovered_${recording.startedAt}`;
        meetingId = base;
        for (let n = 2; await db.getMeetingById(meetingId); n++) meetingId = `${base}_${n}`;
    }

    // Encoded natively; the PCM is deleted only once the audio file exists
    const { filePath, durationMs } = await meetingAudioConverter.recoverRecording({ path: recording.path });
    const stored = await storeMeetingAudioFile(meetingId, filePath);
    if (!stored) throw new Error(`Recovered audio could not be stored: ${filePath}`);

    const existing = await db.getMeetingById(meetingId);
    await db.attachRecoveredAudio({
        id: meetingId,
        timestamp: recording.startedAt,
        durationSec: durationMs / 1000,
        audioPath: stored.relativePath,
        mimeType: stored.mimeType ?? 'audio/mp4'
    });
    logger.log('info', `[Meeting] Recovered ${Math.round(durationMs / 1000)} s of interrupted recording into ${meetingId}`);
    return { meetingId, startedAt: recording.startedAt, durationMs, created: !existing };
}

/**
 * Recovers recordings cut short by the app being killed: each is encoded, attached to its
 * checkpointed meeting (or to a new one) and reported once. A failure keeps the PCM for the next
 * start. Concurrent callers share the same run.
 */
export function recoverInterruptedRecordings(): Promise<RecoveredRecording[]> {
    if (!Capacitor.isNativePlatform()) return Promise.resolve([]);
    if (running) return running;

    running = (async () => {
        const recovered: RecoveredRecording[] = [];
        let recordings: OrphanRecording[] = [];
        try {
            recordings = (await meetingAudioConverter.listOrphanRecordings()).recordings ?? [];
        } catch (error) {
            logger.log('warn', '[Meeting] Interrupted recordings could not be listed', error);
            return recovered;
        }
        for (const recording of recordings) {
            try {
                const result = await recoverOne(recording);
                if (result) recovered.push(result);
            } catch (error) {
                logger.log('error', '[Meeting] Recovery of an interrupted recording failed (retried next time)', error);
            }
        }
        return recovered;
    })().finally(() => { running = null; });
    return running;
}

/** "Recording interrupted at 14:05 recovered (12 min)": the time is where the audio ends */
export function describeRecoveredRecording(recording: RecoveredRecording, locale?: string): string {
    const interruptedAt = recording.startedAt + recording.durationMs;
    const time = new Date(interruptedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    const seconds = Math.round(recording.durationMs / 1000);
    const length = seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
    return `Recording interrupted at ${time} recovered (${length})`;
}
