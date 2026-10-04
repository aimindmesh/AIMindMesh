/**
 * Storage of known voices (voice_profiles) and of each meeting's speaker voices (voices_json).
 * Voices never leave the phone.
 */

import { MeetingDatabase } from '../database/meetingDatabase';
import { logger } from '../logger';
import { compactEmbedding, MeetingVoices, normalize, OWNER_VOICE_ID, VoiceProfile } from './voiceProfiles';

const db = () => MeetingDatabase.getInstance();

export async function listVoiceProfiles(): Promise<VoiceProfile[]> {
    const rows = await db().query('SELECT * FROM voice_profiles ORDER BY name COLLATE NOCASE');
    return rows.flatMap(row => {
        try {
            return [{ id: row.id, name: row.name, embedding: JSON.parse(row.embedding_json), meetings: row.meetings, updatedAt: row.updated_at }];
        } catch {
            logger.log('warn', `Skipping unreadable voice profile ${row.id}`);
            return [];
        }
    });
}

export async function saveVoiceProfile(profile: VoiceProfile): Promise<void> {
    await db().run(
        `INSERT INTO voice_profiles (id, name, embedding_json, meetings, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, embedding_json = excluded.embedding_json,
            meetings = excluded.meetings, updated_at = excluded.updated_at`,
        [profile.id, profile.name, JSON.stringify(profile.embedding), profile.meetings, profile.updatedAt]
    );
}

/** Key of the owner's enrolled voice used for live speaker 0 (VoiceEnrollmentModal, speakerEmbedding). */
export const OWNER_VOICE_STORAGE_KEY = 'user-voice-profile-onnx';

export async function deleteVoiceProfile(id: string): Promise<void> {
    await db().run('DELETE FROM voice_profiles WHERE id = ?', [id]);
    if (id === OWNER_VOICE_ID) {
        // The live "speaker 0 is the owner" seeding goes with it
        try { localStorage.removeItem(OWNER_VOICE_STORAGE_KEY); } catch { /* storage unavailable */ }
    }
}

/** The owner's enrolled voice becomes (or updates) the reserved known voice "voice_owner". */
export async function saveOwnerVoice(name: string, embedding: number[]): Promise<void> {
    await saveVoiceProfile({
        id: OWNER_VOICE_ID,
        name,
        embedding: compactEmbedding(normalize(embedding)),
        meetings: 1,
        updatedAt: Date.now()
    });
}

/** Local data: the meeting is not marked for sync. */
export async function saveMeetingVoices(meetingId: string, voices: MeetingVoices): Promise<void> {
    await db().updateVoices(meetingId, JSON.stringify(voices));
}

export async function loadMeetingVoices(meetingId: string): Promise<MeetingVoices> {
    const [row] = await db().query('SELECT voices_json FROM meetings WHERE id = ?', [meetingId]);
    try {
        return row?.voices_json ? JSON.parse(row.voices_json) : {};
    } catch {
        return {};
    }
}
