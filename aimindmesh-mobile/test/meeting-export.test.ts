import { describe, expect, it } from 'vitest';
import { toHTMLForPDF, toMarkdown, toSRT } from '../src/services/meeting/meetingExportService';
import { SavedMeeting } from '../src/types/meeting';

const meeting: SavedMeeting = {
    id: 'm1',
    timestamp: new Date(2026, 9, 3, 9, 45, 0).getTime(),
    duration: 3725, // seconds, as stored
    hasAudio: true,
    speakerNames: { 0: 'Anna' },
    transcript: [
        { id: 'a', speakerId: 0, text: 'Buongiorno a tutti.', timestamp: 0, start_ms: 2000, end_ms: 4000 },
        { id: 'b', speakerId: 1, text: 'Il budget è <ancora> da "chiudere" & firmare.', timestamp: 0, start_ms: 3_661_000, end_ms: 3_663_500 },
    ],
    title: '',
    bookmarks: [],
    analysis: null,
    questions: [],
};

const withNotes: SavedMeeting = {
    ...meeting,
    title: 'Budget <Q3>',
    bookmarks: [{ id: 'bm', ms: 3_662_000 }],
    analysis: {
        title: 'AI title',
        summary: 'Il budget va chiuso.',
        keyPoints: [{ text: 'Firma del budget', atMs: 3_661_000 }],
        decisions: [],
        actionItems: [{ task: 'Firmare il budget', owner: 'Anna', due: 'venerdì', atMs: 3_661_000 }],
        openQuestions: [],
        source: 'transcript',
        model: 'm',
        createdAt: 0
    },
};

describe('meeting export', () => {
    it('shows the meeting date, its real duration and everyone who speaks', () => {
        const md = toMarkdown(meeting);
        expect(md).toContain(new Date(meeting.timestamp).toLocaleDateString());
        expect(md).toContain('**Duration:** 1h 2m 5s');
        expect(md).toContain('**Speakers:** Anna, Speaker 2');
    });

    it('labels sentences with their position in the recording', () => {
        const md = toMarkdown(meeting);
        expect(md).toContain('`0:02` **Anna**: Buongiorno a tutti.');
        expect(md).toContain('`1:01:01` **Speaker 2**:');
    });

    it('escapes transcript text in the PDF HTML', () => {
        const html = toHTMLForPDF(meeting);
        expect(html).toContain('Il budget è &lt;ancora&gt; da &quot;chiudere&quot; &amp; firmare.');
        expect(html).not.toContain('<ancora>');
    });

    it('puts the title, the AI notes and the marked moments before the transcript', () => {
        const md = toMarkdown(withNotes);
        expect(md.startsWith('# Budget <Q3>')).toBe(true);
        expect(md).toContain('## Summary\n\nIl budget va chiuso.');
        expect(md).toContain('- Firma del budget `1:01:01`');
        expect(md).toContain('- [ ] Firmare il budget (Anna, venerdì) `1:01:01`');
        expect(md).toContain('## Marked moments\n\n- `1:01:02` — Il budget è');
        expect(md).not.toContain('## Decisions');
        expect(md.indexOf('## Marked moments')).toBeLessThan(md.indexOf('## Transcript'));
    });

    it('leaves the notes out when asked, and titles untitled meetings by date', () => {
        expect(toMarkdown(withNotes, { includeSpeakerLabels: true, includeTimestamps: true, includeWordTimestamps: false, includeNotes: false }))
            .not.toContain('## Summary');
        expect(toMarkdown(meeting)).toMatch(/^# Meeting of /);
    });

    it('escapes the notes in the PDF HTML', () => {
        const html = toHTMLForPDF(withNotes);
        expect(html).toContain('<h1>Budget &lt;Q3&gt;</h1>');
        expect(html).toContain('<h2>Action items</h2>');
    });

    it('writes SRT cues on the recording timeline', () => {
        expect(toSRT(meeting)).toContain('01:01:01,000 --> 01:01:03,500');
    });
});
