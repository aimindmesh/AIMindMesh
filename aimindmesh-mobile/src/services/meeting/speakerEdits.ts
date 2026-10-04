/**
 * Manual speaker corrections: who says a sentence, and the names of the speakers.
 */

import { TranscriptSegment } from '../../types/meeting';
import type { DialogChoice } from '../ui/dialogs';

export function speakerLabel(speakerId: number, names: Record<number, string>): string {
    return names[speakerId] || `Speaker ${speakerId + 1}`;
}

/** Speakers in order of first appearance, plus named ones that no longer speak. */
export function knownSpeakers(transcript: TranscriptSegment[], names: Record<number, string>): number[] {
    const ids = [...new Set(transcript.map(t => t.speakerId))];
    for (const id of Object.keys(names).map(Number)) {
        if (!ids.includes(id)) ids.push(id);
    }
    return ids;
}

/** A speaker number nobody uses yet. */
export function newSpeakerId(transcript: TranscriptSegment[], names: Record<number, string>): number {
    const used = knownSpeakers(transcript, names);
    return used.length === 0 ? 0 : Math.max(...used) + 1;
}

/** The menu for a sentence's speaker: rename them, or move the sentence to another speaker. */
export function speakerMenuChoices(
    transcript: TranscriptSegment[],
    names: Record<number, string>,
    segment: TranscriptSegment
): DialogChoice[] {
    const current = speakerLabel(segment.speakerId, names);
    return [
        { id: 'rename', label: `Rename "${current}"`, description: 'Everywhere in this meeting' },
        ...knownSpeakers(transcript, names)
            .filter(id => id !== segment.speakerId)
            .map(id => ({ id: `set:${id}`, label: `Said by ${speakerLabel(id, names)}`, description: 'Only this sentence' })),
        { id: 'new', label: 'Said by a new speaker', description: 'Only this sentence' },
    ];
}

/** The transcript with one sentence given to another speaker. */
export function assignSpeaker(transcript: TranscriptSegment[], segmentId: string, speakerId: number): TranscriptSegment[] {
    return transcript.map(t => (t.id === segmentId ? { ...t, speakerId } : t));
}
