import { AhcStrategy } from '../../speaker/clustering/AhcStrategy';

export interface SpeakerItem {
    id: string;
    startMs: number;
    endMs: number;
    /** L2-normalized voice embedding of the item's audio, null when too short to tell. */
    embedding: number[] | null;
}

export interface SpeakerAssignmentOptions {
    /** Average cosine distance above which two groups are different speakers. */
    distanceThreshold: number;
    /** Known number of speakers, if the user set it. */
    targetSpeakers?: number;
    /**
     * A "speaker" heard for less than this in total is almost always a noisy embedding of
     * someone else: its items go to the closest voice instead. 0 keeps every cluster.
     */
    minSpeakerMs?: number;
}

/**
 * Groups transcript items by voice: clusters the embeddings (average-linkage AHC), numbers
 * speakers by who talks first, and gives items without an embedding the speaker of the
 * nearest item in time (a short "Sì." most likely belongs to the turn around it).
 * Clusters heard for less than `minSpeakerMs` are folded into the closest remaining voice.
 */
export function assignSpeakers(items: SpeakerItem[], options: SpeakerAssignmentOptions): Map<string, number> {
    const withVoice = items.filter(i => i.embedding && i.embedding.length > 0);
    const result = new Map<string, number>();
    if (withVoice.length === 0) {
        items.forEach(i => result.set(i.id, 0));
        return result;
    }

    const clusters = new AhcStrategy().cluster(
        withVoice.map(i => ({ id: i.id, embedding: i.embedding!, timestamp: i.startMs })),
        { distanceThreshold: options.distanceThreshold, targetSpeakers: options.targetSpeakers }
    );
    clusters.speakerAssignments.forEach((speaker, id) => result.set(id, speaker));
    if (options.minSpeakerMs) foldShortSpeakers(withVoice, result, options.minSpeakerMs);

    const anchors = withVoice.map(i => ({ mid: (i.startMs + i.endMs) / 2, speaker: result.get(i.id)! }));
    for (const item of items) {
        if (result.has(item.id)) continue;
        const mid = (item.startMs + item.endMs) / 2;
        let best = anchors[0];
        for (const a of anchors) {
            if (Math.abs(a.mid - mid) < Math.abs(best.mid - mid)) best = a;
        }
        result.set(item.id, best.speaker);
    }
    return result;
}

function foldShortSpeakers(items: SpeakerItem[], speakers: Map<string, number>, minSpeakerMs: number): void {
    const talk = new Map<number, number>();
    for (const i of items) {
        const sp = speakers.get(i.id)!;
        talk.set(sp, (talk.get(sp) ?? 0) + (i.endMs - i.startMs));
    }
    const kept = [...talk.keys()].filter(sp => talk.get(sp)! >= minSpeakerMs);
    if (kept.length === 0 || kept.length === talk.size) return;

    // Mean direction of each kept voice
    const centroids = new Map<number, number[]>();
    for (const sp of kept) {
        const members = items.filter(i => speakers.get(i.id) === sp);
        const sum = new Array(members[0].embedding!.length).fill(0);
        members.forEach(m => m.embedding!.forEach((v, k) => { sum[k] += v; }));
        const norm = Math.hypot(...sum) || 1;
        centroids.set(sp, sum.map(v => v / norm));
    }
    for (const i of items) {
        if (kept.includes(speakers.get(i.id)!)) continue;
        let best = kept[0];
        let bestSim = -Infinity;
        for (const sp of kept) {
            const sim = centroids.get(sp)!.reduce((acc, v, k) => acc + v * i.embedding![k], 0);
            if (sim > bestSim) { bestSim = sim; best = sp; }
        }
        speakers.set(i.id, best);
    }
}
