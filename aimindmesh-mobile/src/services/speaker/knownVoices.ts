/**
 * Known-voice recognition for meetings: names speakers whose voice was named before, and
 * learns a voice when the user names a speaker.
 */

import { logger } from '../logger';
import { learnVoice, MeetingVoices, recognizeVoices } from './voiceProfiles';
import { listVoiceProfiles, loadMeetingVoices, saveMeetingVoices, saveVoiceProfile } from './voiceStorage';

/**
 * Stores a meeting's speaker voices and, when `recognize` is on, returns names for the
 * speakers whose voice is known (speaker number → name).
 */
export async function nameKnownSpeakers(meetingId: string, voices: MeetingVoices, recognize: boolean): Promise<Record<number, string>> {
    const names: Record<number, string> = {};
    if (Object.keys(voices).length === 0) return names;
    try {
        await saveMeetingVoices(meetingId, voices);
        if (!recognize) return names;
        recognizeVoices(voices, await listVoiceProfiles()).forEach((profile, speaker) => { names[speaker] = profile.name; });
    } catch (e) {
        logger.log('warn', 'Known-voice recognition failed', e);
    }
    return names;
}

/**
 * Learns `name`'s voice from speaker `speakerId` of a meeting (its average voice, stored when it
 * was transcribed). Returns false when the meeting has no voice for that speaker.
 */
export async function learnSpeakerVoice(meetingId: string, speakerId: number, name: string): Promise<boolean> {
    const voice = (await loadMeetingVoices(meetingId))[speakerId];
    if (!voice) return false;
    const existing = (await listVoiceProfiles()).find(p => p.name.toLocaleLowerCase() === name.toLocaleLowerCase()) ?? null;
    await saveVoiceProfile(learnVoice(existing, name, voice));
    logger.log('info', `Learned a voice for speaker ${speakerId} (${existing ? 'updated' : 'new'} profile)`);
    return true;
}

export async function knownVoiceNames(): Promise<string[]> {
    return (await listVoiceProfiles().catch(() => [])).map(p => p.name);
}
