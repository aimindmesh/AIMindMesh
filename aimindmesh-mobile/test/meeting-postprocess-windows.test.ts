import { describe, expect, it } from 'vitest';
import { speakersByOverlap, speechWindows } from '../src/services/meeting/postProcessing/speechWindows';

describe('speechWindows', () => {
    it('cuts long regions into ~3 s windows and keeps short ones whole', () => {
        const windows = speechWindows([{ startMs: 0, endMs: 9000 }, { startMs: 10_000, endMs: 11_500 }]);
        expect(windows).toEqual([
            { startMs: 0, endMs: 3000 },
            { startMs: 3000, endMs: 6000 },
            { startMs: 6000, endMs: 9000 },
            { startMs: 10_000, endMs: 11_500 },
        ]);
    });

    it('skips regions too short to tell voices apart', () => {
        expect(speechWindows([{ startMs: 0, endMs: 600 }])).toEqual([]);
    });
});

describe('speakersByOverlap', () => {
    const windows = [
        { startMs: 0, endMs: 3000, speaker: 0 },
        { startMs: 3000, endMs: 6000, speaker: 0 },
        { startMs: 9300, endMs: 12_000, speaker: 1 },
    ];

    it('picks the speaker who talks most during the segment', () => {
        // Straddles the end of speaker 0 and the start of speaker 1, mostly speaker 1
        const speakers = speakersByOverlap([{ id: 's', startMs: 5500, endMs: 11_000 }], windows);
        expect(speakers.get('s')).toBe(1);
    });

    it('falls back to the nearest window for segments in a gap', () => {
        const speakers = speakersByOverlap([{ id: 'gap', startMs: 6200, endMs: 6800 }], windows);
        expect(speakers.get('gap')).toBe(0);
    });
});
