import { Capacitor } from '@capacitor/core';
import AudioConverter from '../audio/audioConverter';
import { logger } from '../logger';
import { MeetingDatabase } from '../database/meetingDatabase';
import { isMeetingDeleted } from './meetingDeletions';
import { storeMeetingAudioFile } from './meetingStorage';
import { attachRecordingToMeeting } from './meetingRecords';
import { bookmarksFromPositions } from './meetingNotes';
import { MeetingRecorder, RecoverableSession } from '../audio/meetingRecorder';

/** A recording left on disk by an app killed while recording (legacy AudioConverter .pcm). */
export interface OrphanRecording {
    path: string;
    /** Empty when the recording was not tied to a meeting (older versions) */
    meetingId: string;
    startedAt: number;
    durationMs: number;
}

/** AudioConverter methods used by meetings (the native plugin implements them). */
export interface MeetingAudioConverter {
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

export interface RecoveryResult {
    recovered: RecoveredRecording[];
    /** Native sessions whose audio could not be saved now: offered again (or to discard) */
    failed: RecoverableSession[];
}

let running: Promise<RecoveryResult> | null = null;

/**
 * The meeting a recovered recording goes to: its own, unless that meeting was deleted by the
 * user (here or on another device); then a new id that never reuses an existing meeting (its
 * audio would be overwritten).
 */
async function recoveryTarget(meetingId: string, startedAt: number): Promise<string> {
    const db = MeetingDatabase.getInstance();
    if (meetingId && !isMeetingDeleted(meetingId) && !await db.hasSyncDeletion('meeting', meetingId)) return meetingId;
    const base = `recovered_${startedAt}`;
    let target = base;
    for (let n = 2; await db.getMeetingById(target); n++) target = `${base}_${n}`;
    return target;
}

/** A session of the native recorder left on disk: encoded into its meeting, with its marks. */
async function recoverSession(session: RecoverableSession): Promise<RecoveredRecording | null> {
    if (session.durationMs < MIN_RECOVERY_MS) {
        await MeetingRecorder.discard({ sessionId: session.sessionId });
        return null;
    }
    const meetingId = await recoveryTarget(session.meetingId, session.startedAt);
    const existing = await MeetingDatabase.getInstance().getMeetingById(meetingId);
    const audio = await MeetingRecorder.finalizeRecording({
        sessionId: session.sessionId,
        targetMeetingId: meetingId !== session.meetingId ? meetingId : undefined
    });
    await attachRecordingToMeeting({
        meetingId: audio.meetingId,
        startedAt: audio.startedAt,
        durationMs: audio.durationMs,
        mimeType: audio.mimeType,
        bookmarks: bookmarksFromPositions(audio.bookmarks)
    });
    logger.log('info', `[Meeting] Recovered ${Math.round(audio.durationMs / 1000)} s of interrupted recording into ${audio.meetingId}`);
    return { meetingId: audio.meetingId, startedAt: audio.startedAt, durationMs: audio.durationMs, created: !existing };
}

async function recoverOne(recording: OrphanRecording): Promise<RecoveredRecording | null> {
    if (recording.durationMs < MIN_RECOVERY_MS) {
        await meetingAudioConverter.discardRecording({ path: recording.path });
        return null;
    }

    const db = MeetingDatabase.getInstance();
    const meetingId = await recoveryTarget(recording.meetingId, recording.startedAt);

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
 * checkpointed meeting (or to a new one) and reported once. Sessions of the native recorder come
 * first, then the .pcm files of older versions. A failure keeps the audio for the next start
 * (native sessions are also returned, so the user can retry or discard them). Concurrent callers
 * share the same run.
 */
export function recoverInterruptedRecordingsDetailed(): Promise<RecoveryResult> {
    if (!Capacitor.isNativePlatform()) return Promise.resolve({ recovered: [], failed: [] });
    if (running) return running;

    running = (async () => {
        const result: RecoveryResult = { recovered: [], failed: [] };
        try {
            for (const session of (await MeetingRecorder.listRecoverable()).sessions ?? []) {
                try {
                    const recovered = await recoverSession(session);
                    if (recovered) result.recovered.push(recovered);
                } catch (error) {
                    logger.log('error', '[Meeting] Recovery of an interrupted recording failed', error);
                    result.failed.push(session);
                }
            }
        } catch (error) {
            logger.log('warn', '[Meeting] Interrupted recordings could not be listed', error);
        }

        let recordings: OrphanRecording[] = [];
        try {
            recordings = (await meetingAudioConverter.listOrphanRecordings()).recordings ?? [];
        } catch (error) {
            logger.log('warn', '[Meeting] Interrupted recordings of older versions could not be listed', error);
        }
        for (const recording of recordings) {
            try {
                const recovered = await recoverOne(recording);
                if (recovered) result.recovered.push(recovered);
            } catch (error) {
                logger.log('error', '[Meeting] Recovery of an interrupted recording failed (retried next time)', error);
            }
        }
        return result;
    })().finally(() => { running = null; });
    return running;
}

/** As recoverInterruptedRecordingsDetailed, the recordings recovered only. */
export async function recoverInterruptedRecordings(): Promise<RecoveredRecording[]> {
    return (await recoverInterruptedRecordingsDetailed()).recovered;
}

/** Retries a native session whose recovery failed. */
export async function retryRecoverSession(session: RecoverableSession): Promise<RecoveredRecording | null> {
    return recoverSession(session);
}

/** "Recording interrupted at 14:05 recovered (12 min)": the time is where the audio ends */
export function describeRecoveredRecording(recording: RecoveredRecording, locale?: string): string {
    const interruptedAt = recording.startedAt + recording.durationMs;
    const time = new Date(interruptedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    const seconds = Math.round(recording.durationMs / 1000);
    const length = seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
    return `Recording interrupted at ${time} recovered (${length})`;
}
