import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../src/services/security/secretStore', () => ({
  readSetting: (key: string, fallback: unknown) => (store.has(key) ? store.get(key) : fallback),
  storeSetting: (key: string, value: unknown) => store.set(key, value)
}));

import { migrateSpeakerCalibration, needsVoiceReenrollment } from '../src/services/speaker/speakerCalibration';
import { migrateTranscriptionMode } from '../src/hooks/meeting/useMeetingSettings';

beforeEach(() => {
  localStorage.clear();
  store.clear();
});

describe('meeting settings after the update', () => {
  it('live Whisper and Hybrid become Vosk; Voxtral and Off stay', () => {
    expect(migrateTranscriptionMode('whisper')).toBe('vosk');
    expect(migrateTranscriptionMode('hybrid')).toBe('vosk');
    expect(migrateTranscriptionMode(null)).toBe('vosk');
    expect(migrateTranscriptionMode('voxtral')).toBe('voxtral');
    expect(migrateTranscriptionMode('off')).toBe('off');
  });

  it('drops the old speaker thresholds once, keeping the ones the user changed', () => {
    localStorage.setItem('embedding-threshold', '0.8');
    localStorage.setItem('embedding-rejection-threshold', '0.42');
    store.set('speech-config', { embeddingThreshold: 0.8, sttProvider: 'vosk' });
    migrateSpeakerCalibration();
    expect(localStorage.getItem('embedding-threshold')).toBeNull();
    expect(localStorage.getItem('embedding-rejection-threshold')).toBe('0.42');
    expect(store.get('speech-config')).toEqual({ embeddingThreshold: 0.6, sttProvider: 'vosk' });

    localStorage.setItem('embedding-threshold', '0.8'); // set by the user after the update
    migrateSpeakerCalibration();
    expect(localStorage.getItem('embedding-threshold')).toBe('0.8');
  });

  it('asks to record the owner voice again (the old one used other features)', () => {
    localStorage.setItem('user-voice-profile-onnx', '[0.1,0.2]');
    migrateSpeakerCalibration();
    expect(localStorage.getItem('user-voice-profile-onnx')).toBeNull();
    expect(needsVoiceReenrollment()).toBe(true);
  });

  it('does nothing to an install without an enrolled voice', () => {
    migrateSpeakerCalibration();
    expect(needsVoiceReenrollment()).toBe(false);
  });
});
