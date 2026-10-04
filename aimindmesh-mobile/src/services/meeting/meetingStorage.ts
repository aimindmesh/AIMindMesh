/**
 * Meeting storage: metadata and transcript in SQLite, audio as files in Directory.Data
 * (meeting-audio/<id>.audio). Legacy localStorage meetings are migrated on load.
 */

import { Capacitor } from '@capacitor/core';
import { FileSystemAdapter as Filesystem, Directory, Encoding } from '../../utils/fileSystemAdapter';
import { logger } from '../logger';
import { SavedMeeting, TranscriptSegment, WordTimestamp } from '../../types/meeting';
import { DBMeeting, DBMeetingSegment, MeetingDatabase } from '../database/meetingDatabase';
import { audioExtensionForMime, guessAudioMimeType, toDataRelativePath, toNativePath } from './audioPaths';
import { isMeetingDeleted, MeetingDeletedError } from './meetingDeletions';
import { notesFromRow, notesToRow } from './meetingNotes';

const STORAGE_KEY = 'saved-meetings';
const AUDIO_DIR = 'meeting-audio';
const EXPORT_DIR = 'meeting-exports';

/** A stored meeting with its transcript and notes, as the screens use it. */
export function mapDBMeetingToSavedMeeting(dbMeeting: DBMeeting, segments: DBMeetingSegment[]): SavedMeeting {
    let speakerNames = {};
    try {
        if (dbMeeting.speaker_names_json) {
            speakerNames = JSON.parse(dbMeeting.speaker_names_json);
        }
    } catch (e) {
        logger.log('warn', 'Failed to parse speaker_names_json', e);
    }

    const transcript: TranscriptSegment[] = segments.map(seg => {
        let words: WordTimestamp[] | undefined;
        try {
            if (seg.words_json) {
                words = JSON.parse(seg.words_json);
            }
        } catch (e) { }

        return {
            id: seg.id,
            speakerId: seg.speaker_id,
            text: seg.text,
            timestamp: dbMeeting.timestamp + seg.start_ms,
            start_ms: seg.start_ms,
            end_ms: seg.end_ms,
            stt_provider: seg.stt_provider || undefined,
            confidence: seg.confidence !== null ? seg.confidence : undefined,
            words,
            originalText: seg.original_text || undefined,
            isEdited: seg.is_edited,
            editedAt: seg.edited_at || undefined
        };
    });

    return {
        id: dbMeeting.id,
        timestamp: dbMeeting.timestamp,
        transcript,
        speakerNames,
        duration: dbMeeting.duration,
        hasAudio: dbMeeting.has_audio,
        audioMimeType: dbMeeting.audio_mime_type || undefined,
        ...notesFromRow(dbMeeting)
    };
}

/** Transcript rows for SQLite (times rounded: the columns are INTEGER). */
export function toDBSegments(meetingId: string, transcript: TranscriptSegment[]): DBMeetingSegment[] {
    return transcript.map((t, idx) => ({
        id: t.id,
        meeting_id: meetingId,
        sequence: idx,
        start_ms: Math.round(t.start_ms ?? 0),
        end_ms: Math.round(t.end_ms ?? 0),
        text: t.text,
        speaker_id: t.speakerId,
        stt_provider: t.stt_provider || null,
        confidence: t.confidence ?? null,
        words_json: t.words ? JSON.stringify(t.words) : null,
        original_text: t.originalText || null,
        is_edited: t.isEdited || false,
        edited_at: t.editedAt || null
    }));
}

/**
 * Get the audio file path for a meeting
 */
export function getAudioPath(meetingId: string): string {
    return `${AUDIO_DIR}/${meetingId}.audio`;
}

async function ensureDir(path: string): Promise<void> {
    try {
        await Filesystem.mkdir({ path, directory: Directory.Data, recursive: true });
    } catch (e) {
        // Directory may already exist
    }
}

/**
 * Locates a meeting's audio file: `path` is the file:// URI (for the WebView), `filePath` the
 * plain path native plugins need.
 */
export async function getMeetingAudioFile(meetingId: string): Promise<{ path: string; filePath: string; isLegacy: boolean; mimeType?: string } | null> {
    try {
        const path = getAudioPath(meetingId);
        await Filesystem.stat({ path, directory: Directory.Data });
        const uriResult = await Filesystem.getUri({ path, directory: Directory.Data });
        return {
            path: uriResult.uri,
            filePath: toNativePath(uriResult.uri),
            isLegacy: false // We assume optimized file by default now
        };
    } catch (e) {
        return null;
    }
}

export interface StoredMeetingAudio {
    relativePath: string;
    /** Plain absolute path */
    filePath: string;
    /** Null when the file was already in place (its stored type is kept) */
    mimeType: string | null;
}

/**
 * Moves a finished recording into meeting storage. Moving (not copying) keeps the temporary
 * recording from staying behind and doubling the space; copy is only the fallback.
 */
export async function storeMeetingAudioFile(meetingId: string, sourcePath: string): Promise<StoredMeetingAudio | null> {
    const target = getAudioPath(meetingId);
    const relative = toDataRelativePath(sourcePath);
    try {
        let mimeType: string | null = null;
        if (relative !== target) {
            mimeType = guessAudioMimeType(sourcePath);
            await ensureDir(AUDIO_DIR);
            const from = relative ?? `file://${toNativePath(sourcePath)}`;
            const directory = relative ? Directory.Data : undefined;
            try {
                await Filesystem.rename({ from, to: target, directory, toDirectory: Directory.Data });
            } catch (moveError) {
                logger.log('warn', 'Moving the recording failed, copying it instead', moveError);
                await Filesystem.copy({ from, to: target, directory, toDirectory: Directory.Data });
                await Filesystem.deleteFile({ path: from, directory }).catch(() => { });
            }
        }
        const { uri } = await Filesystem.getUri({ path: target, directory: Directory.Data });
        logger.log('info', `Audio stored for meeting ${meetingId}`);
        return { relativePath: target, filePath: toNativePath(uri), mimeType };
    } catch (error) {
        logger.log('error', 'Failed to store the meeting audio', error);
        return null;
    }
}

/** Base64 (without the data: prefix) of a Blob, read natively by FileReader. */
export function blobToBase64(blob: Blob): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * Save audio data to Filesystem (legacy JSON + base64 format, used for in-memory audio only)
 */
async function saveAudioToFile(meetingId: string, audioData: string, mimeType: string): Promise<void> {
    await ensureDir(AUDIO_DIR);
    await Filesystem.writeFile({
        path: getAudioPath(meetingId),
        data: JSON.stringify({ mimeType, data: audioData }),
        directory: Directory.Data,
        encoding: Encoding.UTF8
    });
    logger.log('info', `Audio saved to file for meeting ${meetingId}`);
}

/**
 * Load audio data from Filesystem
 * Handling both legacy JSON-base64 and new raw files
 */
async function loadAudioFromFile(meetingId: string): Promise<{ data: string; mimeType: string } | null> {
    try {
        const path = getAudioPath(meetingId);
        // Raw recordings can be large: only small files can be legacy JSON
        const stat = await Filesystem.stat({ path, directory: Directory.Data });
        if (stat.size > 50 * 1024 * 1024) return null;

        const result = await Filesystem.readFile({ path, directory: Directory.Data, encoding: Encoding.UTF8 });
        try {
            const payload = JSON.parse(result.data as string);
            if (typeof payload.data === 'string' && payload.mimeType) {
                return { data: payload.data, mimeType: payload.mimeType };
            }
        } catch (jsonError) {
            // Not JSON: raw audio
        }
        return null;
    } catch (error) {
        return null;
    }
}

/**
 * Delete audio file from Filesystem
 */
async function deleteAudioFile(meetingId: string): Promise<void> {
    try {
        await Filesystem.deleteFile({
            path: getAudioPath(meetingId),
            directory: Directory.Data
        });
        logger.log('info', `Audio file deleted for meeting ${meetingId}`);
    } catch (error) {
        // File may not exist, ignore
    }
}

export interface MeetingAudioInput {
    /** Recording file to move into meeting storage (skipped when it is already there) */
    filePath?: string | null;
    /** In-memory WAV, used only when no recording file exists */
    pcmBlob?: Blob | null;
}

/**
 * Save or update a meeting. Audio fields are only ever added, so saving the transcript alone keeps
 * the stored audio; meetings are never deleted implicitly (the old 50-meeting cap did that).
 * Notes fields left undefined are not written: the stored ones stay.
 */
export async function saveMeeting(
    meeting: Omit<SavedMeeting, 'id'> & { id?: string },
    audio: MeetingAudioInput = {}
): Promise<SavedMeeting & { audioFilePath?: string }> {
    const meetingId = meeting.id || Date.now().toString();
    // A meeting deleted while open must not come back through a late autosave
    if (isMeetingDeleted(meetingId)) throw new MeetingDeletedError(meetingId);
    let hasAudio = !!meeting.hasAudio;
    let audioPath: string | null = null;
    let mimeType: string | null = meeting.audioMimeType ?? null;
    let storedFilePath: string | undefined;

    if (audio.filePath) {
        const stored = await storeMeetingAudioFile(meetingId, audio.filePath);
        if (stored) {
            hasAudio = true;
            audioPath = stored.relativePath;
            mimeType = stored.mimeType ?? mimeType;
            storedFilePath = stored.filePath;
        }
    } else if (audio.pcmBlob && audio.pcmBlob.size > 0) {
        try {
            const blobType = audio.pcmBlob.type || 'audio/wav';
            await saveAudioToFile(meetingId, await blobToBase64(audio.pcmBlob), blobType);
            hasAudio = true;
            audioPath = getAudioPath(meetingId);
            mimeType = blobType;
        } catch (e) {
            logger.log('warn', 'Failed to save in-memory audio', e);
        }
    }

    const dbSegments = toDBSegments(meetingId, meeting.transcript);
    const dbMeeting: DBMeeting = {
        id: meetingId,
        timestamp: meeting.timestamp || Date.now(),
        duration: meeting.duration || 0,
        has_audio: hasAudio,
        audio_file_path: audioPath,
        audio_mime_type: mimeType,
        speaker_names_json: JSON.stringify(meeting.speakerNames || {}),
        ...notesToRow(meeting)
    };

    try {
        await MeetingDatabase.getInstance().saveMeeting(dbMeeting, dbSegments);
    } catch (dbError) {
        // No localStorage fallback: it runs out of quota on long meetings. The caller tells the user.
        logger.log('error', 'Failed to save meeting', dbError);
        throw dbError;
    }
    return {
        ...mapDBMeetingToSavedMeeting(dbMeeting, dbSegments),
        // Notes not given here were not written: they are not known (undefined), not empty
        title: meeting.title,
        bookmarks: meeting.bookmarks,
        analysis: meeting.analysis,
        questions: meeting.questions,
        audioFilePath: storedFilePath
    };
}

/**
 * Moves meetings of the localStorage era into SQLite (those not in `knownIds`), returning them.
 * The key is kept until the migration has been proven on this deployment cycle.
 */
export async function migrateLegacyMeetings(knownIds: Set<string>): Promise<SavedMeeting[]> {
    const savedMeetingsStr = localStorage.getItem(STORAGE_KEY);
    if (!savedMeetingsStr) return [];
    const mdb = MeetingDatabase.getInstance();
    const migrated: SavedMeeting[] = [];
    const legacyMeetings: SavedMeeting[] = JSON.parse(savedMeetingsStr);
    for (const legacy of legacyMeetings) {
        if (knownIds.has(legacy.id)) continue;
        logger.log('info', `Migrating legacy meeting ${legacy.id} to SQLite`);

        // Ids namespaced by meeting: "seg_0" from two meetings collided on the primary key
        const legacyTranscript = legacy.transcript.map((t, idx) => ({
            ...t,
            id: t.id || `${legacy.id}_seg_${idx}`
        }));
        const migratedSegments = toDBSegments(legacy.id, legacyTranscript);
        const migratedDbMeeting: DBMeeting = {
            id: legacy.id,
            timestamp: legacy.timestamp,
            duration: legacy.duration || 0,
            has_audio: legacy.hasAudio,
            audio_file_path: legacy.hasAudio ? getAudioPath(legacy.id) : null,
            audio_mime_type: legacy.audioMimeType || null,
            speaker_names_json: JSON.stringify(legacy.speakerNames || {})
        };

        await mdb.saveMeeting(migratedDbMeeting, migratedSegments);
        migrated.push(mapDBMeetingToSavedMeeting(migratedDbMeeting, migratedSegments));
    }
    return migrated;
}

/**
 * Load all saved meetings from SQLite (fallback and migrate from localStorage)
 */
export async function loadMeetingsAsync(): Promise<SavedMeeting[]> {
    try {
        const mdb = MeetingDatabase.getInstance();
        const dbMeetings = await mdb.getAllMeetings();
        const segmentsByMeeting = await mdb.getAllSegmentsByMeeting();

        const result: SavedMeeting[] = dbMeetings.map(dbm =>
            mapDBMeetingToSavedMeeting(dbm, segmentsByMeeting.get(dbm.id) ?? [])
        );

        try {
            const known = new Set(result.map(m => m.id));
            for (const migrated of await migrateLegacyMeetings(known)) result.push(migrated);
        } catch (lsError) {
            logger.log('error', 'Error migrating legacy localStorage meetings', lsError);
        }

        result.sort((a, b) => b.timestamp - a.timestamp);
        return result;
    } catch (error) {
        logger.log('error', 'Failed to load meetings from SQLite', error);
        return [];
    }
}

/**
 * Load audio data for a specific meeting from Filesystem
 */
export async function loadMeetingAudio(meetingId: string): Promise<{ data: string; mimeType: string } | null> {
    return loadAudioFromFile(meetingId);
}

/**
 * Copies a meeting's audio to meeting-exports/ with a real extension (other apps reject ".audio")
 * and returns its plain path for the share sheet. Old meetings stored base64 inside JSON.
 */
export async function prepareMeetingAudioExport(
    meetingId: string,
    mimeType?: string | null
): Promise<{ filePath: string; mimeType: string }> {
    await ensureDir(EXPORT_DIR);
    // Recordings made by this app are raw AAC ('audio/mp4'); other types may be legacy JSON files
    const legacy = mimeType && mimeType !== 'audio/mp4' ? await loadAudioFromFile(meetingId) : null;
    if (legacy && !legacy.data) throw new Error('This meeting has no audio data');

    const finalMime = legacy?.mimeType ?? mimeType ?? 'audio/mp4';
    const target = `${EXPORT_DIR}/meeting_${meetingId}.${audioExtensionForMime(finalMime)}`;
    if (legacy) {
        // No encoding: base64 data is written as binary
        await Filesystem.writeFile({ path: target, data: legacy.data, directory: Directory.Data });
    } else {
        await Filesystem.copy({ from: getAudioPath(meetingId), to: target, directory: Directory.Data, toDirectory: Directory.Data });
    }
    const { uri } = await Filesystem.getUri({ path: target, directory: Directory.Data });
    return { filePath: toNativePath(uri), mimeType: finalMime };
}

/**
 * Playable URL of a saved meeting's audio and the plain path native plugins need (null for audio
 * that only exists in memory). Legacy recordings stored base64 inside JSON: those become blob URLs.
 */
export async function resolveMeetingAudio(meeting: SavedMeeting): Promise<{ url: string; filePath: string | null } | null> {
    const file = await getMeetingAudioFile(meeting.id);
    const legacyFormat = !!meeting.audioMimeType && meeting.audioMimeType !== 'audio/mp4';
    const legacy = legacyFormat ? await loadAudioFromFile(meeting.id) : null;
    const base64 = legacy?.data || (!file ? meeting.audioData : undefined);
    if (base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const type = legacy?.mimeType || meeting.audioMimeType || 'audio/webm';
        return { url: URL.createObjectURL(new Blob([bytes], { type })), filePath: null };
    }
    if (!file || (legacy && !legacy.data)) return null;
    return { url: Capacitor.convertFileSrc(file.path), filePath: file.filePath };
}

/** Filesystem reference for a plain path: relative to Data when possible, else a file:// URI. */
export function filesystemRefFor(path: string): { path: string; directory?: Directory } {
    const relative = toDataRelativePath(path);
    return relative ? { path: relative, directory: Directory.Data } : { path: `file://${toNativePath(path)}` };
}

/**
 * Files of a deleted meeting: its audio, plus the legacy localStorage copy (which the migration
 * would otherwise bring back).
 */
export async function deleteMeetingFiles(meetingId: string): Promise<void> {
    await deleteAudioFile(meetingId);
    try {
        const str = localStorage.getItem(STORAGE_KEY);
        if (str) {
            const meetings: SavedMeeting[] = JSON.parse(str);
            const remaining = meetings.filter(m => m.id !== meetingId);
            if (remaining.length !== meetings.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
        }
    } catch (e) { }
}

/**
 * Delete a meeting by ID (a tombstone is kept for sync; an open Meeting mode is told)
 */
export async function deleteMeeting(meetingId: string): Promise<boolean> {
    try {
        await MeetingDatabase.getInstance().deleteMeeting(meetingId);
        await deleteMeetingFiles(meetingId);
        logger.log('info', `Meeting ${meetingId} deleted`);
        return true;
    } catch (error) {
        logger.log('error', 'Failed to delete meeting', error);
        return false;
    }
}
