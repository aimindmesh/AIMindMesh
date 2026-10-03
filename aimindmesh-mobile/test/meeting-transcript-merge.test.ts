import { describe, expect, it } from 'vitest';
import { applyVoxtralUpdate, initialVoxtralCursor, skipVoxtralText, VoxtralCursor } from '../src/services/meeting/voxtralSegments';
import { mergeWhisperRefinement } from '../src/services/meeting/hybridRefinement';
import { planChunks, parseWavHeader, whisperResultToSegments } from '../src/services/meeting/reprocessHelpers';
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

describe('hybrid refinement', () => {
  const live = (id: string, start: number, end: number, extra: Partial<TranscriptSegment> = {}): TranscriptSegment =>
    ({ id, speakerId: 0, text: `vosk ${id}`, timestamp: 0, start_ms: start, end_ms: end, stt_provider: 'vosk', ...extra });

  it('assigns each Whisper segment to one live segment', () => {
    const merged = mergeWhisperRefinement(
      [live('a', 0, 2000), live('b', 2000, 5000), live('c', 5000, 6000)],
      [{ text: 'First.', startMs: 100, endMs: 1900 }, { text: 'Second', startMs: 2100, endMs: 3000 }, { text: 'part.', startMs: 3000, endMs: 4800 }]
    );
    expect(merged.map(s => s.text)).toEqual(['First.', 'Second part.', 'vosk c']);
    expect(merged[1].start_ms).toBe(2000); // live timing kept
    expect(merged[2].stt_provider).toBe('vosk');
  });

  it('leaves untimed, edited and already refined segments alone', () => {
    const segments = [
      live('a', 0, 0),
      live('b', 0, 3000, { isEdited: true, text: 'user text' }),
      live('c', 3000, 6000, { stt_provider: 'whisper', text: 'done' })
    ];
    const merged = mergeWhisperRefinement(segments, [{ text: 'Whisper', startMs: 0, endMs: 6000 }]);
    expect(merged).toBe(segments);
  });
});

describe('reprocessing helpers', () => {
  it('places Whisper segments on the recording timeline', () => {
    let n = 0;
    const segments = whisperResultToSegments(
      { text: 'a b', segments: [{ text: ' a ', startMs: 0, endMs: 1000 }, { text: ' ', startMs: 1000, endMs: 1500 }, { text: 'b', startMs: 1500, endMs: 2000 }] },
      { offsetMs: 30000, meetingTimestamp: 1_000_000, makeId: () => `w${n++}` }
    );
    expect(segments.map(s => [s.id, s.text, s.start_ms, s.end_ms, s.timestamp])).toEqual([
      ['w0', 'a', 30000, 31000, 1_030_000],
      ['w1', 'b', 31500, 32000, 1_031_500]
    ]);
    const single = whisperResultToSegments({ text: ' all ' }, { offsetMs: 0, durationMs: 5000, meetingTimestamp: 0, makeId: () => 'x' });
    expect(single[0]).toMatchObject({ text: 'all', start_ms: 0, end_ms: 5000 });
  });

  it('plans chunks covering the whole audio', () => {
    expect(planChunks(25, 10)).toEqual([{ start: 0, end: 10 }, { start: 10, end: 20 }, { start: 20, end: 25 }]);
    expect(planChunks(0, 10)).toEqual([]);
  });

  it('reads WAV headers with extra chunks before data', () => {
    const buffer = new ArrayBuffer(64);
    const view = new DataView(buffer);
    const tag = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
    tag(0, 'RIFF'); tag(8, 'WAVE');
    tag(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint16(34, 16, true);
    tag(36, 'LIST'); view.setUint32(40, 4, true);
    tag(48, 'data'); view.setUint32(52, 8, true);
    expect(parseWavHeader(buffer)).toEqual({ channels: 1, sampleRate: 16000, bitsPerSample: 16, dataOffset: 56, dataLength: 8 });
    expect(parseWavHeader(new ArrayBuffer(8))).toBeNull();
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
