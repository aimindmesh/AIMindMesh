/**
 * Prompts for the AI meeting notes and questions, and parsing of the answers.
 */

import { ActionItem, AnalysisPoint, Bookmark, MeetingAnalysis, MeetingQuestion, TranscriptSegment } from '../../types/meeting';
import { speakerLabel } from '../meeting/speakerEdits';

const LANGUAGE_NAMES: Record<string, string> = {
    it: 'Italian',
    en: 'English',
    es: 'Spanish',
    fr: 'French',
    de: 'German',
};

const COMMON_WORDS: Record<string, string[]> = {
    it: ['il', 'lo', 'la', 'che', 'di', 'non', 'per', 'una', 'sono', 'è', 'del', 'della', 'anche', 'questo', 'perché', 'come', 'ma', 'con', 'gli', 'poi'],
    en: ['the', 'and', 'is', 'to', 'of', 'that', 'you', 'it', 'we', 'this', 'are', 'for', 'have', 'with', 'what', 'but', 'not', 'they', 'so', 'be'],
    es: ['el', 'los', 'que', 'de', 'no', 'para', 'una', 'es', 'con', 'por', 'pero', 'como', 'muy', 'está', 'del', 'las', 'esto', 'también'],
    fr: ['le', 'les', 'que', 'de', 'ne', 'pas', 'pour', 'une', 'est', 'avec', 'mais', 'comme', 'nous', 'vous', 'des', 'du', 'cette', 'aussi'],
    de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'zu', 'ein', 'eine', 'mit', 'auch', 'aber', 'wir', 'sie', 'den', 'dem', 'ich', 'es'],
};

/**
 * The transcript's language from its most common words, or undefined if too little text.
 * Used to ask the AI for notes in the language of the meeting.
 */
export function guessLanguage(text: string): string | undefined {
    const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
    if (words.length < 8) return undefined;
    let best: string | undefined;
    let bestScore = 0;
    for (const [lang, common] of Object.entries(COMMON_WORDS)) {
        const set = new Set(common);
        const score = words.filter(w => set.has(w)).length;
        if (score > bestScore) {
            best = lang;
            bestScore = score;
        }
    }
    return bestScore >= 3 ? best : undefined;
}

/** "Italian", or a generic instruction when the language is unknown. */
export function languageInstruction(language: string | undefined): string {
    const name = language ? LANGUAGE_NAMES[language] : undefined;
    return name ? `in ${name}` : 'in the language spoken in the meeting';
}

/** m:ss, or h:mm:ss past the first hour. */
export function formatClock(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Milliseconds from "m:ss" / "mm:ss" / "h:mm:ss" (also inside brackets), or undefined. */
export function parseClock(value: unknown): number | undefined {
    if (typeof value === 'number' && isFinite(value)) return Math.max(0, Math.round(value * 1000));
    if (typeof value !== 'string') return undefined;
    const match = value.trim().match(/^\[?(?:(\d+):)?(\d{1,3}):(\d{2})\]?$/);
    if (!match) return undefined;
    const [, h, m, s] = match;
    if (Number(s) >= 60) return undefined;
    return ((Number(h ?? 0) * 60 + Number(m)) * 60 + Number(s)) * 1000;
}



/** "[m:ss] Name: text" lines, the format the prompts describe. */
export function formatTranscriptForPrompt(transcript: TranscriptSegment[], speakerNames: Record<number, string>): string {
    return transcript
        .filter(seg => seg.text.trim())
        .map(seg => {
            const time = seg.start_ms != null ? `[${formatClock(seg.start_ms)}] ` : '';
            return `${time}${speakerLabel(seg.speakerId, speakerNames)}: ${seg.text.trim()}`;
        })
        .join('\n');
}

export const MEETING_SYSTEM_PROMPT = `You are an expert meeting assistant. You write accurate, concise notes of meetings.
Transcripts come from speech recognition and may contain recognition errors and wrong speaker labels: infer the intended words from context, and never add facts that were not said in the meeting.`;

const ANALYSIS_FORMAT = `Return only a JSON object, without code fences, with this structure:
{"title": "...", "summary": "...", "keyPoints": [{"text": "...", "at": "m:ss"}], "decisions": [{"text": "...", "at": "m:ss"}], "actionItems": [{"task": "...", "owner": "...", "due": "...", "at": "m:ss"}], "openQuestions": [{"text": "...", "at": "m:ss"}]}

- title: at most 8 words, specific to this meeting.
- summary: one short paragraph with the purpose of the meeting and its conclusions.
- keyPoints: the main topics and facts discussed, most important first.
- decisions: what was agreed. Empty list if nothing was decided.
- actionItems: tasks someone has to do. Include owner and due only if they were said.
- openQuestions: questions or issues raised and left unresolved.
- at: when the item is discussed, as the time of the transcript line (m:ss or h:mm:ss).`;

export interface AnalysisRequest {
    transcript: TranscriptSegment[];
    speakerNames: Record<number, string>;
    bookmarks: Bookmark[];
    language?: string;
}

function bookmarkInstruction(bookmarks: Bookmark[]): string {
    if (bookmarks.length === 0) return '';
    const times = bookmarks.map(b => formatClock(b.ms)).join(', ');
    return `\n\nDuring the meeting the user marked these moments as important: ${times}. Make sure the notes cover what was said around them.`;
}

/** The prompt asking for structured notes of a transcript. */
export function buildTranscriptAnalysisPrompt(req: AnalysisRequest): string {
    return `Write the notes of this meeting ${languageInstruction(req.language)}.

${ANALYSIS_FORMAT}${bookmarkInstruction(req.bookmarks)}

TRANSCRIPT ([time] speaker: text):
${formatTranscriptForPrompt(req.transcript, req.speakerNames)}`;
}

/** The same notes, from the recording itself (for models that take audio). */
export function buildAudioAnalysisPrompt(req: Pick<AnalysisRequest, 'bookmarks' | 'language'>): string {
    return `Listen to this meeting recording and write its notes ${languageInstruction(req.language)}.

${ANALYSIS_FORMAT.replace('as the time of the transcript line', 'as the time in the recording')}${bookmarkInstruction(req.bookmarks)}`;
}

/** The prompt answering a question about the meeting, with the earlier questions as context. */
export function buildQuestionPrompt(
    req: Pick<AnalysisRequest, 'transcript' | 'speakerNames'>,
    previous: MeetingQuestion[],
    question: string
): string {
    const history = previous.slice(-5)
        .map(q => `QUESTION: ${q.question}\nANSWER: ${q.answer}`)
        .join('\n\n');
    return `Answer a question about the meeting below, using only what was said in it.
- Answer in the language of the question, briefly and directly. Markdown lists are fine.
- Cite the times of the passages your answer relies on, in square brackets, e.g. [12:34].
- If the meeting does not contain the answer, say so.

TRANSCRIPT ([time] speaker: text):
${formatTranscriptForPrompt(req.transcript, req.speakerNames)}
${history ? `\nEARLIER QUESTIONS:\n${history}\n` : ''}
QUESTION: ${question}`;
}

// ─── Parsing ─────────────────────────────────────────────

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function asPoints(value: unknown): AnalysisPoint[] {
    if (!Array.isArray(value)) return [];
    return value
        .map(item => typeof item === 'string'
            ? { text: item.trim() }
            : { text: asText(item?.text ?? item?.point ?? item?.description), atMs: parseClock(item?.at) })
        .filter(p => p.text)
        .map(p => (p.atMs === undefined ? { text: p.text } : p));
}

function asActionItems(value: unknown): ActionItem[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item): ActionItem => {
            if (typeof item === 'string') return { task: item.trim() };
            const action: ActionItem = { task: asText(item?.task ?? item?.text) };
            const owner = asText(item?.owner);
            const due = asText(item?.due);
            const atMs = parseClock(item?.at);
            // Models write "null" or "N/A" for fields they were told to leave out
            if (owner && !/^(null|none|n\/?a|-|unknown)$/i.test(owner)) action.owner = owner;
            if (due && !/^(null|none|n\/?a|-|unknown)$/i.test(due)) action.due = due;
            if (atMs !== undefined) action.atMs = atMs;
            return action;
        })
        .filter(a => a.task);
}

/** The JSON object in a model answer, tolerating code fences and text around it. */
function extractJson(raw: string): any | null {
    const text = raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
        return JSON.parse(text.slice(start, end + 1));
    } catch {
        return null;
    }
}

/**
 * Reads the model's notes. When the answer isn't the requested JSON (truncated, or the model
 * ignored the format), its text is kept as markdown so nothing the user paid for is lost.
 */
export function parseAnalysis(
    raw: string,
    meta: Pick<MeetingAnalysis, 'source' | 'model' | 'createdAt'>
): MeetingAnalysis {
    const json = extractJson(raw);
    const analysis: MeetingAnalysis = {
        title: '',
        summary: '',
        keyPoints: [],
        decisions: [],
        actionItems: [],
        openQuestions: [],
        ...meta
    };
    if (json && typeof json === 'object') {
        analysis.title = asText(json.title).replace(/^["']|["']$/g, '');
        analysis.summary = asText(json.summary);
        analysis.keyPoints = asPoints(json.keyPoints ?? json.key_points);
        analysis.decisions = asPoints(json.decisions);
        analysis.actionItems = asActionItems(json.actionItems ?? json.action_items);
        analysis.openQuestions = asPoints(json.openQuestions ?? json.open_questions);
    }
    const empty = !analysis.summary && analysis.keyPoints.length === 0 && analysis.actionItems.length === 0;
    if (empty) {
        analysis.markdown = raw.trim();
    }
    return analysis;
}
