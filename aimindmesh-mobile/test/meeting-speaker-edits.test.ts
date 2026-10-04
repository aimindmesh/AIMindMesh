import { describe, expect, it } from 'vitest';
import { assignSpeaker, knownSpeakers, newSpeakerId, speakerMenuChoices } from '../src/services/meeting/speakerEdits';
import { TranscriptSegment } from '../src/types/meeting';

const seg = (id: string, speakerId: number): TranscriptSegment => ({ id, speakerId, text: id, timestamp: 0 });
const transcript = [seg('a', 1), seg('b', 0), seg('c', 1), seg('d', 2)];

describe('speaker corrections', () => {
    it('lists speakers by first appearance, then named ones that no longer speak', () => {
        expect(knownSpeakers(transcript, { 5: 'Ospite' })).toEqual([1, 0, 2, 5]);
    });

    it('offers to rename the speaker or move only this sentence to another one', () => {
        const choices = speakerMenuChoices(transcript, { 0: 'Anna' }, transcript[0]);
        expect(choices.map(c => c.id)).toEqual(['rename', 'set:0', 'set:2', 'new']);
        expect(choices[0].label).toBe('Rename "Speaker 2"');
        expect(choices[1].label).toBe('Said by Anna');
    });

    it('gives one sentence to another speaker and leaves the rest alone', () => {
        const changed = assignSpeaker(transcript, 'c', 2);
        expect(changed.map(t => t.speakerId)).toEqual([1, 0, 2, 2]);
        expect(changed[0]).toBe(transcript[0]);
    });

    it('picks an unused number for a new speaker', () => {
        expect(newSpeakerId(transcript, { 5: 'Ospite' })).toBe(6);
        expect(newSpeakerId([], {})).toBe(0);
    });
});
