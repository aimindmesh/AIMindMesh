import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';

const fs = vi.hoisted(() => ({ files: [] as Array<{ name: string; type: string }> }));
vi.mock('../src/utils/fileSystemAdapter', () => ({
  Directory: { Data: 'DATA' },
  FileSystemAdapter: {
    readdir: async ({ path }: { path: string }) => ({ files: path === 'vosk-models' ? fs.files : [{ name: 'am', type: 'directory' }, { name: 'conf', type: 'directory' }] })
  }
}));
vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));

import { WHISPER_MODELS } from '../src/services/stt/whisperModelDownloader';
import { listLocalVoskModels, VOSK_MODELS } from '../src/services/stt/voskModelDownloader';
import { VAD_MODELS } from '../src/services/stt/vadModelDownloader';

/** name -> size of the files the fetch script puts in the APK */
const fetchScript = readFileSync('scripts/fetch-bundled-models.sh', 'utf8');

describe('model catalogs', () => {
  it('have unique ids', () => {
    for (const ids of [WHISPER_MODELS.map(m => m.id), VOSK_MODELS.map(m => m.id), VAD_MODELS.map(m => m.id)]) {
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('every bundled model is one the fetch script ships', () => {
    for (const m of WHISPER_MODELS.filter(m => m.bundled)) expect(fetchScript).toContain(`${m.id}.bin|`);
    for (const m of VOSK_MODELS.filter(m => m.bundled)) expect(fetchScript).toContain(`${m.id}.zip|`);
    expect(fetchScript).toContain('silero_vad.onnx|');
  });

  it('keeps fast models for voice chat next to the meeting ones', () => {
    const ids = WHISPER_MODELS.map(m => m.id);
    expect(ids).toEqual(expect.arrayContaining(['ggml-tiny', 'ggml-base', 'ggml-base-q8_0', 'ggml-small-q8_0', 'ggml-small-q5_1']));
    expect(WHISPER_MODELS.find(m => m.recommended)?.id).toBe('ggml-small-q8_0');
  });
});

describe('listLocalVoskModels', () => {
  it('lists recognition models only: not the speaker model nor models still being unpacked', async () => {
    fs.files = [
      { name: 'vosk-model-small-it-0.22', type: 'directory' },
      { name: 'vosk-model-spk-0.4', type: 'directory' },
      { name: 'vosk-model-en-us-0.22-lgraph.tmp', type: 'directory' },
      { name: 'vosk-model-it-0.22.zip', type: 'file' },
    ];
    expect(await listLocalVoskModels()).toEqual(['vosk-model-small-it-0.22']);
  });
});
