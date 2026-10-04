import { describe, expect, it } from 'vitest';
import { applyVoxtralUpdate, initialVoxtralCursor, skipVoxtralText, VoxtralCursor } from '../src/services/meeting/voxtralSegments';
import { newSegmentId } from '../src/services/meeting/meetingIds';
import { extractMeetingCandidates } from '../src/services/meetingOrganizationBridge';
import { TranscriptSegment } from '../src/types/meeting';

function voxtralRun(updates: Array<{ text: string; speaker: number }>) {
  let segments: TranscriptSegment[] = [];
  let cursor: VoxtralCursor = initialVoxtralCursor();
  let accumulated = '';
  let id = 0;
  for (const u of updates) {
    accumulated += u.text;
    const r = applyVoxtralUpdate(segments, cursor, accumulated, u.text, u.speaker, { startMs: 0, endMs: 0 }, () => `s${id++}`, 0);
    segments = r.segments;
    cursor = r.cursor;
  }
  return { segments, cursor, accumulated };
}

describe('Voxtral segments', () => {
  it('gives each speaker only the text said while they were speaking', () => {
    const { segments } = voxtralRun([
      { text: 'Hello ', speaker: 0 },
      { text: 'everyone.', speaker: 0 },
      { text: ' Hi Anna,', speaker: 1 },
      { text: ' how are you?', speaker: 1 },
      { text: ' Fine.', speaker: 0 }
    ]);
    expect(segments.map(s => [s.speakerId, s.text])).toEqual([
      [0, 'Hello everyone.'],
      [1, 'Hi Anna, how are you?'],
      [0, 'Fine.']
    ]);
  });

  it('drops text received while paused and starts a new segment after it', () => {
    let { segments, accumulated } = voxtralRun([{ text: 'Before.', speaker: 0 }]);
    accumulated += ' secret';
    let cursor = skipVoxtralText(accumulated);
    accumulated += ' After.';
    const r = applyVoxtralUpdate(segments, cursor, accumulated, ' After.', 0, { startMs: 0, endMs: 0 }, () => 'x', 0);
    segments = r.segments;
    cursor = r.cursor;
    expect(segments.map(s => s.text)).toEqual(['Before.', 'After.']);
    expect(cursor.segmentId).toBe('x');
  });
});

describe('ids and bridge', () => {
  it('generates unique segment ids within the same millisecond', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newSegmentId('vosk')));
    expect(ids.size).toBe(1000);
  });

  it('extracts candidates on whole words, without the speaker prefix in the title', () => {
    const candidates = extractMeetingCandidates('Anna: we should ship on Friday\nBob: I was focused on tests');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].title).toBe('we should ship on Friday');
  });
});
