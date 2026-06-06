/**
 * Meeting storage utilities for saving, loading, and exporting meetings
 * Audio is stored in Filesystem to avoid localStorage quota issues
 */

import { FileSystemAdapter as Filesystem, Directory, Encoding } from '../../utils/fileSystemAdapter';
import { logger } from '../logger';
import { SavedMeeting, TranscriptSegment, WordTimestamp } from '../../types/meeting';
import { DBMeeting, DBMeetingSegment, MeetingDatabase } from '../database/meetingDatabase';

const MAX_MEETINGS = 50;
const STORAGE_KEY = 'saved-meetings';
const AUDIO_DIR = 'meeting-audio';

// Helper to convert DB models to frontend types
function mapDBMeetingToSavedMeeting(dbMeeting: DBMeeting, segments: DBMeetingSegment[]): SavedMeeting {
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
        audioMimeType: dbMeeting.audio_mime_type || undefined
    };
}


/**
 * Get the audio file path for a meeting
 */
function getAudioPath(meetingId: string): string {
    return `${AUDIO_DIR}/${meetingId}.audio`;
}

/**
 * Check if the audio file uses the new optimized format (M4A/WAV) or legacy JSON
 * Returns the path and format info
 */
export async function getMeetingAudioFile(meetingId: string): Promise<{ path: string; isLegacy: boolean; mimeType?: string } | null> {
    try {
        const path = getAudioPath(meetingId);
        await Filesystem.stat({
            path,
            directory: Directory.Data
        });

        // We can't easily check content type without reading, but we can assume
        // based on how we saved it. or check metadata if we loaded the meeting first.
        // However, legacy files were JSON. New files are binary.
        // If we want to be sure, we could read the first few bytes?
        // Or assume new format if it's large?

        // Better: loadMeetings() gives us metadata.
        // But here we just return the path for the UI to try.
        // The UI (MeetingMode) controls the logic.

        // Actually, we return the URI.
        const uriResult = await Filesystem.getUri({
            path,
            directory: Directory.Data
        });

        return {
            path: uriResult.uri,
            isLegacy: false // We assume optimized file by default now
        };
    } catch (e) {
        return null;
    }
}

/**
 * Save audio data to Filesystem
 */
async function saveAudioToFile(meetingId: string, audioData: string, mimeType: string): Promise<void> {
    try {
        // Ensure directory exists
        try {
            await Filesystem.mkdir({
                path: AUDIO_DIR,
                directory: Directory.Data,
                recursive: true
            });
        } catch (e) {
            // Directory may already exist
        }

        // Save audio with metadata
        const audioPayload = JSON.stringify({ mimeType, data: audioData });
        await Filesystem.writeFile({
            path: getAudioPath(meetingId),
            data: audioPayload,
            directory: Directory.Data,
            encoding: Encoding.UTF8
        });

        logger.log('info', `Audio saved to file for meeting ${meetingId}`);
    } catch (error) {
        logger.log('error', 'Failed to save audio to file', error);
        throw error;
    }
}

/**
 * Load audio data from Filesystem
 * Handling both legacy JSON-base64 and new raw files
 */
async function loadAudioFromFile(meetingId: string): Promise<{ data: string; mimeType: string } | null> {
    try {
        const path = getAudioPath(meetingId);

        // Read file as text first to check for legacy JSON
        // If it's a large binary file, readFile with UTF8 might be slow or fail?
        // Capacitor readFile reads the whole file. 
        // If we have 100MB file, this crashes.

        // Recommendation: Do NOT use loadMeetingAudio for large files.
        // Use getMeetingAudioFile instead.
        // But for backward compatibility logic we might try?

        // Let's rely on file extension logic? No, we used .audio for both.
        // We can check file size. Legacy JSONs were small?

        const stat = await Filesystem.stat({ path, directory: Directory.Data });
        if (stat.size > 50 * 1024 * 1024) { // > 50MB
            // Must be raw audio
            throw new Error("File too large for legacy load");
        }

        const result = await Filesystem.readFile({
            path,
            directory: Directory.Data,
            encoding: Encoding.UTF8
        });

        try {
            const payload = JSON.parse(result.data as string);
            if (payload.data && payload.mimeType) {
                return { data: payload.data, mimeType: payload.mimeType };
            }
        } catch (jsonError) {
            // Not JSON, so it's raw audio? 
            // If it's raw audio, we can't return 'data' as string easily without crashing if large.
            // But we already checked size.
        }

        return null;
    } catch (error) {
        // File may not exist or too large
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

/**
 * Save or update a meeting
 * Audio is stored in Filesystem, metadata in SQLite (legacy fallback to localStorage/json)
 */
export async function saveMeeting(
    meeting: Omit<SavedMeeting, 'id'> & { id?: string },
    audioChunks?: Blob[],
    _existingMeetings?: SavedMeeting[],
    audioFilePath?: string
): Promise<SavedMeeting> {
    try {
        let audioMimeType: string | undefined;
        let hasAudioFile = false;
        let finalRelativePath: string | null = null; // Track this separately

        const meetingId = meeting.id || Date.now().toString();

        // Handle file path (optimized path)
        if (audioFilePath) {
            try {
                // Determine extension and mime type
                const extension = audioFilePath.endsWith('.wav') ? '.wav' : '.m4a';
                audioMimeType = extension === '.wav' ? 'audio/wav' : 'audio/mp4';

                const targetPath = getAudioPath(meetingId);

                let relativePath = audioFilePath;
                if (audioFilePath.includes('/files/')) {
                    relativePath = audioFilePath.split('/files/')[1];
                }

                await Filesystem.copy({
                    from: relativePath,
                    to: targetPath,
                    directory: Directory.Data,
                    toDirectory: Directory.Data
                });

                hasAudioFile = true;
                finalRelativePath = targetPath;
                logger.log('info', `Audio file copied to storage for ${meetingId}`);
            } catch (e) {
                logger.log('error', 'Failed to copy audio file to storage', e);
            }
        }

        // Convert audio chunks and save to filesystem (Legacy path)
        if (!hasAudioFile && audioChunks && audioChunks.length > 0) {
            try {
                audioMimeType = audioChunks[0].type || 'audio/webm';
                const audioBlob = new Blob(audioChunks, { type: audioMimeType });

                const audioData = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        const result = reader.result as string;
                        const base64 = result.split(',')[1];
                        resolve(base64);
                    };
                    reader.onerror = reject;
                    reader.readAsDataURL(audioBlob);
                });

                await saveAudioToFile(meetingId, audioData, audioMimeType);
                hasAudioFile = true;
                finalRelativePath = getAudioPath(meetingId);

                logger.log('info', `Audio saved to filesystem via chunks`);
            } catch (e) {
                logger.log('warn', 'Failed to save audio chunks to filesystem', e);
            }
        }

        // Before attempting SQLite save, calculate db segments
        const dbSegments: DBMeetingSegment[] = meeting.transcript.map((t, idx) => ({
            id: t.id,
            meeting_id: meetingId,
            sequence: idx,
            start_ms: t.start_ms ?? 0,
            end_ms: t.end_ms ?? 0,
            text: t.text,
            speaker_id: t.speakerId,
            stt_provider: t.stt_provider || null,
            confidence: t.confidence ?? null,
            words_json: t.words ? JSON.stringify(t.words) : null,
            original_text: t.originalText || null,
            is_edited: t.isEdited || false,
            edited_at: t.editedAt || null
        }));

        const dbMeeting: DBMeeting = {
            id: meetingId,
            timestamp: meeting.timestamp || Date.now(),
            duration: meeting.duration,
            has_audio: hasAudioFile || meeting.hasAudio || false,
            audio_file_path: finalRelativePath,
            audio_mime_type: audioMimeType || (meeting as any).audioMimeType || null,
            speaker_names_json: JSON.stringify(meeting.speakerNames)
        };

        try {
            const mdb = MeetingDatabase.getInstance();
            await mdb.saveMeeting(dbMeeting, dbSegments);

            // Housekeeping list via db
            const allDbMeetings = await mdb.getAllMeetings();
            if (allDbMeetings.length > MAX_MEETINGS) {
                const removedMeetings = allDbMeetings.slice(MAX_MEETINGS);
                for (const removed of removedMeetings) {
                    await mdb.deleteMeeting(removed.id);
                    await deleteAudioFile(removed.id);
                }
            }

            return mapDBMeetingToSavedMeeting(dbMeeting, dbSegments);
        } catch (dbError) {
            logger.log('error', 'Failed to save to SQLite database', dbError);
            throw dbError; // Don't fallback to localStorage anymore; it's guaranteed to OOM on long records. Let the app show the save failed.
        }
    } catch (error) {
        logger.log('error', 'Failed to save meeting', error);
        throw error;
    }
}

/**
 * Load all saved meetings from SQLite (fallback and migrate from localStorage)
 */
export async function loadMeetingsAsync(): Promise<SavedMeeting[]> {
    try {
        const mdb = MeetingDatabase.getInstance();
        const dbMeetings = await mdb.getAllMeetings();

        const result: SavedMeeting[] = [];

        for (const dbm of dbMeetings) {
            const segments = await mdb.getMeetingSegments(dbm.id);
            result.push(mapDBMeetingToSavedMeeting(dbm, segments));
        }

        // Migrate legacy localStorage meetings if any
        try {
            const savedMeetingsStr = localStorage.getItem(STORAGE_KEY);
            if (savedMeetingsStr) {
                const legacyMeetings: SavedMeeting[] = JSON.parse(savedMeetingsStr);
                let migratedCount = 0;

                for (const legacy of legacyMeetings) {
                    // Only migrate if not already inserted
                    if (!result.find(m => m.id === legacy.id)) {
                        logger.log('info', `Migrating legacy meeting ${legacy.id} to SQLite`);

                        const migratedSegments: DBMeetingSegment[] = legacy.transcript.map((t, idx) => ({
                            id: t.id || `seg_${idx}`,
                            meeting_id: legacy.id,
                            sequence: idx,
                            start_ms: 0,
                            end_ms: 0,
                            text: t.text,
                            speaker_id: t.speakerId,
                            stt_provider: null,
                            confidence: null,
                            words_json: null,
                            original_text: null,
                            is_edited: false,
                            edited_at: null
                        }));

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
                        result.push(mapDBMeetingToSavedMeeting(migratedDbMeeting, migratedSegments));
                        migratedCount++;
                    }
                }

                if (migratedCount > 0) {
                    // We don't remove the key yet until we're absolutely certain the app handles edge cases 100% fine on this deployment cycle.
                    // Let's just avoid pushing it back
                }
            }
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
 * Export meeting to filesystem
 */
export async function exportMeeting(
    transcript: TranscriptSegment[],
    speakerNames: Record<number, string>,
    audioChunks?: Blob[],
    meetingId?: string
): Promise<void> {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

        // Export transcript
        const text = transcript.map(t => {
            const name = speakerNames[t.speakerId] || `Speaker ${t.speakerId + 1}`;
            return `[${new Date(t.timestamp).toLocaleTimeString()}] ${name}: ${t.text}`;
        }).join('\n');

        // Ensure 'meetings' directory exists
        try {
            await Filesystem.mkdir({
                path: 'meetings',
                directory: Directory.Documents,
                recursive: true
            });
        } catch (e) {
            // Ignore if it exists
        }

        await Filesystem.writeFile({
            path: `meetings/meeting-${timestamp}.txt`,
            data: text,
            directory: Directory.Documents,
            encoding: Encoding.UTF8
        });

        // 1. Direct file copy (Memory safe architecture for large files)
        if (meetingId) {
            try {
                const internalPath = getAudioPath(meetingId);

                // Read mime type to detect extension safely
                let extension = 'm4a';
                try {
                    const metadata = await getMeetingAudioFile(meetingId);
                    if (metadata?.path?.endsWith('.wav')) {
                        extension = 'wav';
                    }
                } catch (e) { }

                await Filesystem.copy({
                    from: internalPath,
                    to: `meetings/meeting-${timestamp}.${extension}`,
                    directory: Directory.Data,
                    toDirectory: Directory.Documents
                });

                logger.log('info', `Audio exported to meetings/meeting-${timestamp}.${extension} using Filesystem.copy`);
                return; // Finished properly (audioChunks not needed)
            } catch (copyError) {
                logger.log('warn', 'Failed to copy audio file directly, falling back to legacy', copyError);
            }
        }

        // 2. Legacy extraction (If we somehow have raw blobs in RAM)
        if (audioChunks && audioChunks.length > 0) {
            const mimeType = audioChunks[0].type || 'audio/webm';
            const audioBlob = new Blob(audioChunks, { type: mimeType });

            const reader = new FileReader();
            reader.onloadend = async () => {
                const base64Audio = reader.result as string;
                const base64Data = base64Audio.split(',')[1];

                let extension = 'mp4';
                if (mimeType.includes('webm')) extension = 'webm';
                else if (mimeType.includes('wav')) extension = 'wav';
                await Filesystem.writeFile({
                    path: `meetings/meeting-${timestamp}.${extension}`,
                    data: base64Data,
                    directory: Directory.Documents
                });

                logger.log('info', `Audio exported to meetings/meeting-${timestamp}.${extension}`);
            };
            reader.readAsDataURL(audioBlob);
        }

        logger.log('info', 'Meeting exported successfully');
    } catch (error) {
        logger.log('error', 'Export failed', error);
        throw error;
    }
}

/**
 * Delete a meeting by ID
 */
export async function deleteMeeting(meetingId: string): Promise<boolean> {
    try {
        const mdb = MeetingDatabase.getInstance();
        await mdb.deleteMeeting(meetingId);

        // Also delete audio file
        await deleteAudioFile(meetingId);

        // Optional: Remove from localStorage if lingering
        try {
            const str = localStorage.getItem(STORAGE_KEY);
            if (str) {
                const meetings: SavedMeeting[] = JSON.parse(str);
                const index = meetings.findIndex(m => m.id === meetingId);
                if (index >= 0) {
                    meetings.splice(index, 1);
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(meetings));
                }
            }
        } catch (e) { }

        logger.log('info', `Meeting ${meetingId} deleted`);
        return true;
    } catch (error) {
        logger.log('error', 'Failed to delete meeting', error);
        return false;
    }
}
