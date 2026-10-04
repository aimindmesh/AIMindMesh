import { describe, expect, it } from 'vitest';
import { isMeetingCaptureActive, onMeetingCaptureChange, setMeetingCaptureActive } from '../src/services/meeting/meetingCapture';
import { OWNER_VOICE_ID, recognizeVoices, learnVoice } from '../src/services/speaker/voiceProfiles';

describe('meeting capture flag', () => {
  it('tells listeners when a recording takes and releases the microphone, once per change', () => {
    const seen: boolean[] = [];
    const stop = onMeetingCaptureChange(active => seen.push(active));
    setMeetingCaptureActive(true);
    setMeetingCaptureActive(true);
    expect(isMeetingCaptureActive()).toBe(true);
    setMeetingCaptureActive(false);
    stop();
    setMeetingCaptureActive(true);
    expect(seen).toEqual([true, false]);
    setMeetingCaptureActive(false);
  });
});

describe('known voices with other speaker models', () => {
  const unit = (n: number, i: number) => Array.from({ length: n }, (_, k) => (k === i ? 1 : 0));

  it('never compares a voice with a profile of another embedding size', () => {
    const owner = { id: OWNER_VOICE_ID, name: 'Me', embedding: unit(192, 0), meetings: 1, updatedAt: 0 };
    const anna = { id: 'v1', name: 'Anna', embedding: unit(256, 0), meetings: 1, updatedAt: 0 };
    const named = recognizeVoices({ 0: unit(256, 0) }, [owner, anna]);
    expect(named.get(0)?.name).toBe('Anna');
  });

  it('starts a profile over when the speaker model changed', () => {
    const old = { id: 'v1', name: 'Anna', embedding: unit(192, 0), meetings: 5, updatedAt: 0 };
    const learned = learnVoice(old, 'Anna', unit(256, 1), 10);
    expect(learned).toMatchObject({ id: 'v1', meetings: 1 });
    expect(learned.embedding).toHaveLength(256);
  });
});
