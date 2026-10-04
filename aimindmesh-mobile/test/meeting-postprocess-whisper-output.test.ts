import { describe, expect, it } from 'vitest';
import { cleanWhisperSegments } from '../src/services/meeting/postProcessing/whisperOutput';

const seg = (text: string, startMs: number, endMs: number) => ({ text, startMs, endMs });

describe('cleanWhisperSegments', () => {
    it('trims text and keeps real speech with its timing', () => {
        expect(cleanWhisperSegments([seg('  Buongiorno a tutti.  ', 0, 1500)]))
            .toEqual([{ text: 'Buongiorno a tutti.', startMs: 0, endMs: 1500 }]);
    });

    it('drops annotations, blanks and punctuation-only segments', () => {
        const out = cleanWhisperSegments([
            seg('[Musica]', 0, 1000),
            seg(' (applausi) ', 1000, 2000),
            seg('[BLANK_AUDIO]', 2000, 3000),
            seg('♪ ♪', 3000, 4000),
            seg(' ... ', 4000, 5000),
            seg('Passiamo al budget.', 5000, 7000),
        ]);
        expect(out.map(s => s.text)).toEqual(['Passiamo al budget.']);
    });

    it('drops the subtitle credits Whisper invents on silence', () => {
        const out = cleanWhisperSegments([
            seg('Sottotitoli creati dalla comunità Amara.org', 0, 3000),
            seg('Grazie per la visione!', 3000, 4000),
            seg('Thanks for watching!', 4000, 5000),
            seg('Il cliente è soddisfatto.', 5000, 7000),
        ]);
        expect(out.map(s => s.text)).toEqual(['Il cliente è soddisfatto.']);
    });

    it('collapses a repetition loop into one segment spanning it', () => {
        const out = cleanWhisperSegments([
            seg('Va bene.', 0, 1000),
            seg('va bene', 1000, 2000),
            seg('Va bene!', 2000, 3000),
            seg('Allora procediamo.', 3000, 4500),
        ]);
        expect(out).toEqual([
            { text: 'Va bene.', startMs: 0, endMs: 3000 },
            { text: 'Allora procediamo.', startMs: 3000, endMs: 4500 },
        ]);
    });

    it('does not merge the same words said by two different speakers', () => {
        const out = cleanWhisperSegments([
            { text: 'Sì.', startMs: 0, endMs: 500, speaker: 0 },
            { text: 'Sì.', startMs: 600, endMs: 1000, speaker: 1 },
        ]);
        expect(out.map(s => s.speaker)).toEqual([0, 1]);
    });

    it('drops segments in another alphabet when the meeting language is Latin-script', () => {
        const segs = [seg('unf ば ば', 0, 1000), seg('Perché è così?', 1000, 2000)];
        expect(cleanWhisperSegments(segs, 'it').map(s => s.text)).toEqual(['Perché è così?']);
        expect(cleanWhisperSegments(segs, 'ja')).toHaveLength(2);
    });

    it('keeps timestamps non-decreasing and segments non-empty', () => {
        const out = cleanWhisperSegments([seg('Uno.', 5000, 5000), seg('Due.', 4000, 6000)]);
        expect(out[0].endMs).toBeGreaterThan(out[0].startMs);
        expect(out[1].startMs).toBeGreaterThanOrEqual(out[0].startMs);
    });
});
