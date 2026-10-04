import { describe, expect, it } from 'vitest';
import { audioExtensionForMime, guessAudioMimeType, toDataRelativePath, toNativePath } from '../src/services/meeting/audioPaths';

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
