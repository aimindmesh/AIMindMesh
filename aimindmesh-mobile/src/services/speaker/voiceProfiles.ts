/**
 * Known voices: a named average voice embedding per person, learned when the user names a
 * speaker and used to name the speakers of later meetings.
 */

export interface VoiceProfile {
    id: string;
    name: string;
    /** L2-normalized average ECAPA embedding. */
    embedding: number[];
    /** Meetings it was learned from. */
    meetings: number;
    updatedAt: number;
}

/** The phone owner's voice (Settings → Speaker → voice enrollment) among the known voices. */
export const OWNER_VOICE_ID = 'voice_owner';

/** A voice in one meeting: speaker number → L2-normalized average embedding. */
export type MeetingVoices = Record<number, number[]>;

/**
 * A meeting's average voice against a known one: the same synthetic voice in four recordings
 * scored 0.98-1.00, two different voices about 0.40 (measured on a Galaxy Z Fold5). Real people
 * vary more between meetings, hence the lower threshold; a match must also beat the next
 * candidate clearly. To be checked on real meetings.
 */
export const VOICE_MATCH = { minSimilarity: 0.55, margin: 0.08 };

/** After this many meetings a profile changes slowly, but still follows a voice that drifts. */
const MAX_LEARNING_WEIGHT = 10;

export function normalize(v: number[]): number[] {
    const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
    return norm > 0 ? v.map(x => x / norm) : v;
}

function dot(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) sum += a[i] * b[i];
    return sum;
}

/** Rounded for storage: 4 decimals keep similarities exact to ~1e-3 at a third of the size. */
export function compactEmbedding(v: number[]): number[] {
    return v.map(x => Math.round(x * 10_000) / 10_000);
}

/**
 * Each speaker's average voice from labelled windows, weighted by window length.
 * `speakerOf(i)` gives window i's speaker; windows without an embedding are skipped.
 */
export function voiceCentroids(
    windows: Array<{ startMs: number; endMs: number }>,
    embeddings: Array<number[] | null>,
    speakerOf: (index: number) => number | undefined
): Map<number, number[]> {
    const sums = new Map<number, number[]>();
    windows.forEach((w, i) => {
        const e = embeddings[i];
        const speaker = speakerOf(i);
        if (!e || speaker === undefined) return;
        const weight = (w.endMs - w.startMs) / 1000;
        const sum = sums.get(speaker) ?? new Array(e.length).fill(0);
        e.forEach((x, k) => { sum[k] += x * weight; });
        sums.set(speaker, sum);
    });
    return new Map([...sums].map(([speaker, sum]) => [speaker, compactEmbedding(normalize(sum))]));
}

/**
 * Names a meeting's speakers from known voices. Each profile names at most one speaker and each
 * speaker gets at most one profile, best matches first; a match needs `minSimilarity` and a
 * `margin` over the speaker's next best profile, so two similar voices are left unnamed.
 */
export function recognizeVoices(
    voices: MeetingVoices,
    profiles: VoiceProfile[],
    { minSimilarity, margin } = VOICE_MATCH
): Map<number, VoiceProfile> {
    const candidates: Array<{ speaker: number; profile: VoiceProfile; similarity: number }> = [];
    for (const [speakerKey, voice] of Object.entries(voices)) {
        const speaker = Number(speakerKey);
        // A profile from another speaker model (other embedding size) can't be compared
        const scored = profiles
            .filter(profile => profile.embedding.length === voice.length)
            .map(profile => ({ speaker, profile, similarity: dot(voice, profile.embedding) }))
            .sort((a, b) => b.similarity - a.similarity);
        const [best, second] = scored;
        if (best && best.similarity >= minSimilarity && (!second || best.similarity - second.similarity >= margin)) {
            candidates.push(best);
        }
    }
    const named = new Map<number, VoiceProfile>();
    const used = new Set<string>();
    for (const c of candidates.sort((a, b) => b.similarity - a.similarity)) {
        if (named.has(c.speaker) || used.has(c.profile.id)) continue;
        named.set(c.speaker, c.profile);
        used.add(c.profile.id);
    }
    return named;
}

/** A profile updated with the voice heard in one more meeting (or a new one). */
export function learnVoice(profile: VoiceProfile | null, name: string, voice: number[], now = Date.now()): VoiceProfile {
    if (!profile || profile.embedding.length !== voice.length) {
        // New, or learned with another speaker model: starts over from this voice
        return { id: profile?.id ?? `voice_${now.toString(36)}`, name, embedding: compactEmbedding(normalize(voice)), meetings: 1, updatedAt: now };
    }
    const weight = Math.min(profile.meetings, MAX_LEARNING_WEIGHT);
    const mixed = profile.embedding.map((x, i) => x * weight + (voice[i] ?? 0));
    return { ...profile, name, embedding: compactEmbedding(normalize(mixed)), meetings: profile.meetings + 1, updatedAt: now };
}
