export interface RawSegment {
    text: string;
    startMs: number;
    endMs: number;
    speaker?: number;
}

export interface CleanSegment {
    text: string;
    startMs: number;
    endMs: number;
    speaker?: number;
}

/**
 * Sentences Whisper produces on silence or music: phrases from the subtitles it was trained on.
 * Matched case-insensitively against the whole segment.
 */
const HALLUCINATIONS = [
    /^sottotitoli (creati|e revisione) (dalla|a cura della) comunit[aà] amara\.org\.?$/i,
    /^sottotitoli (a cura di|creati da) .{0,40}$/i,
    /^(grazie (a tutti )?per (la visione|l'attenzione|aver guardato)|grazie e alla prossima)[.!]?$/i,
    /^(thanks|thank you) for watching[.!]?$/i,
    /^subtitles by .{0,40}$/i,
    /^amara\.org$/i,
];

/** Annotations rather than speech: [Musica], (applausi), *risate*, ♪ ... ♪ */
const ANNOTATION = /^\s*([[(*♪].*[\])*♪]|\[BLANK_AUDIO\])\s*$/i;

/** Languages written in the Latin alphabet: other scripts in their transcript are noise. */
const LATIN_LANGUAGES = new Set(['it', 'en', 'es', 'fr', 'de', 'pt', 'nl', 'ro', 'ca', 'pl', 'sv', 'da', 'no', 'fi']);

/** Share of letters outside the Latin alphabet (accents included in Latin). */
function nonLatinRatio(text: string): number {
    const letters = text.match(/\p{L}/gu) || [];
    if (letters.length === 0) return 0;
    const latin = letters.filter(ch => /\p{Script=Latin}/u.test(ch)).length;
    return 1 - latin / letters.length;
}

const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Turns raw Whisper segments (already on the recording's timeline, in order) into transcript
 * text: trims, drops annotations, empty and punctuation-only segments, known hallucinations,
 * and the repetition loops Whisper sometimes falls into (the same sentence again and again).
 * With a Latin-alphabet `language`, segments mostly in another script (e.g. "unf ば" on noise)
 * are dropped too.
 */
export function cleanWhisperSegments(segments: RawSegment[], language?: string): CleanSegment[] {
    const latinOnly = !!language && LATIN_LANGUAGES.has(language);
    const out: CleanSegment[] = [];
    let lastStart = -1;
    for (const seg of segments) {
        const text = seg.text.replace(/\s+/g, ' ').trim();
        if (!text || ANNOTATION.test(text)) continue;
        const norm = normalize(text);
        if (!norm) continue;
        if (HALLUCINATIONS.some(h => h.test(text))) continue;
        if (latinOnly && nonLatinRatio(text) > 0.2) continue;

        const prev = out[out.length - 1];
        if (prev && prev.speaker === seg.speaker && normalize(prev.text) === norm) {
            prev.endMs = Math.max(prev.endMs, seg.endMs); // repetition: extend, don't duplicate
            continue;
        }

        const startMs = Math.max(seg.startMs, lastStart);
        const endMs = Math.max(seg.endMs, startMs + 1);
        out.push({ text, startMs, endMs, ...(seg.speaker !== undefined ? { speaker: seg.speaker } : {}) });
        lastStart = startMs;
    }
    return out;
}
