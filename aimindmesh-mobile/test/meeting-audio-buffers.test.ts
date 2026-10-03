import { describe, expect, it } from 'vitest';
import { appendBounded, countSamples, pickEmbeddingWindow, readRange, readSince } from '../src/services/meeting/pcmBuffer';
import { MeetingTimeline } from '../src/services/meeting/meetingTimeline';
import { audioExtensionForMime, guessAudioMimeType, toDataRelativePath, toNativePath } from '../src/services/meeting/audioPaths';

const chunk = (start: number, length: number) => Float32Array.from({ length }, (_, i) => start + i);

describe('rolling PCM buffer', () => {
  it('keeps absolute offsets valid after the buffer starts trimming', () => {
    const chunks: Float32Array[] = [];
    let dropped = 0;
    let offset = 0;
    const read: number[] = [];
    // 10 chunks of 4 samples into a 12-sample buffer, reading 4 samples after each push
    for (let c = 0; c < 10; c++) {
      dropped += appendBounded(chunks, chunk(c * 4, 4), 12);
      const result = readSince(chunks, dropped, offset, 4);
      read.push(...result.samples);
      offset = result.newOffset;
    }
    // Every sample read exactly once, in order: the index-based offsets stalled here
    expect(read).toEqual(Array.from({ length: 40 }, (_, i) => i));
    expect(countSamples(chunks)).toBe(12);
    expect(dropped).toBe(28);
  });

  it('skips audio already trimmed and reports where the read really starts', () => {
    const chunks: Float32Array[] = [];
    let dropped = 0;
    for (let c = 0; c < 5; c++) dropped += appendBounded(chunks, chunk(c * 4, 4), 8);
    const result = readSince(chunks, dropped, 2, 100);
    expect(result.startOffset).toBe(12);
    expect(Array.from(result.samples)).toEqual([12, 13, 14, 15, 16, 17, 18, 19]);
    expect(result.newOffset).toBe(20);
    expect(readSince(chunks, dropped, 20).samples.length).toBe(0);
  });

  it('reads absolute ranges clipped to what is held', () => {
    const chunks = [chunk(0, 4), chunk(4, 4)];
    expect(Array.from(readRange(chunks, 0, 2, 6))).toEqual([2, 3, 4, 5]);
    expect(Array.from(readRange(chunks, 0, 6, 100))).toEqual([6, 7]);
    expect(readRange(chunks, 0, 9, 12).length).toBe(0);
  });

  it('picks the embedding window on the utterance, at least min long', () => {
    expect(pickEmbeddingWindow(100000, { start: 40000, end: 90000 }, 64000, 32000)).toEqual({ start: 40000, end: 90000 });
    // Short utterance: extended backwards to the minimum
    expect(pickEmbeddingWindow(100000, { start: 80000, end: 90000 }, 64000, 32000)).toEqual({ start: 58000, end: 90000 });
    // Long utterance: the last `target` samples
    expect(pickEmbeddingWindow(200000, { start: 0, end: 150000 }, 64000, 32000)).toEqual({ start: 86000, end: 150000 });
    // Audio not arrived yet: clipped to what is available
    expect(pickEmbeddingWindow(85000, { start: 80000, end: 90000 }, 64000, 32000)).toEqual({ start: 53000, end: 85000 });
    expect(pickEmbeddingWindow(20000, null, 64000, 32000)).toEqual({ start: 0, end: 20000 });
  });
});

describe('meeting timeline', () => {
  it('removes paused time from file positions', () => {
    const t = new MeetingTimeline();
    t.setFileStart(1000);
    t.pause(5000);
    t.resume(8000);
    expect(t.wallToFileMs(4000)).toBe(3000);
    expect(t.wallToFileMs(6000)).toBe(4000); // inside the pause: stays at the pause point
    expect(t.wallToFileMs(10000)).toBe(6000);
    expect(t.isWallPaused(7000)).toBe(true);
    expect(t.isWallPaused(8000)).toBe(false);
  });

  it('maps Vosk times, which start before the recorder', () => {
    const t = new MeetingTimeline();
    t.setVoskStart(1000);
    t.setFileStart(1500);
    expect(t.voskToFileMs(2000)).toBe(1500);
    expect(t.voskToFileMs(100)).toBe(0);
  });

  it('keeps only the samples of a chunk captured outside a pause', () => {
    const t = new MeetingTimeline();
    t.setFileStart(0);
    t.pause(10500);
    // 1 s chunk at 1 kHz ending at 11000: the half before the pause is kept
    expect(t.keptSampleRanges(11000, 1000, 1000)).toEqual([[0, 500]]);
    t.resume(12300);
    expect(t.keptSampleRanges(13000, 1000, 1000)).toEqual([[300, 1000]]);
    expect(t.keptSampleRanges(12200, 1000, 1000)).toEqual([]);
    expect(t.keptSampleRanges(20000, 1000, 1000)).toEqual([[0, 1000]]);
  });
});

describe('audio paths', () => {
  it('converts URIs to native and Data-relative paths', () => {
    const uri = 'file:///data/user/0/com.app/files/meeting-audio/1%202.audio';
    expect(toNativePath(uri)).toBe('/data/user/0/com.app/files/meeting-audio/1 2.audio');
    expect(toDataRelativePath(uri)).toBe('meeting-audio/1 2.audio');
    expect(toDataRelativePath('/data/user/0/com.app/cache/x.m4a')).toBeNull();
    expect(toDataRelativePath('meeting-audio/x.audio')).toBe('meeting-audio/x.audio');
  });

  it('guesses types and extensions', () => {
    expect(guessAudioMimeType('/f/meeting_recording1.m4a')).toBe('audio/mp4');
    expect(guessAudioMimeType('/f/meeting_recording1.WAV')).toBe('audio/wav');
    expect(audioExtensionForMime('audio/mp4')).toBe('m4a');
    expect(audioExtensionForMime('audio/webm;codecs=opus')).toBe('webm');
    expect(audioExtensionForMime(undefined)).toBe('m4a');
  });
});
