import { afterEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
  downloads: [] as { url: string; target: string; waited: boolean }[],
  stored: new Map<string, any>(),
  failUrl: '' as string,
}));

vi.mock('../src/services/model/modelDownloader', () => ({
  // Resolves only after "downloading": the setup must await it before going on
  downloadModel: async (url: string, target: string, onProgress?: (p: any) => void) => {
    if (url === calls.failUrl) throw new Error('HTTP error code: 404');
    const entry = { url, target, waited: false };
    calls.downloads.push(entry);
    onProgress?.({ percentage: 50 });
    await new Promise(r => setTimeout(r, 1));
    entry.waited = true;
    return target;
  },
}));
vi.mock('../src/services/security/secretStore', () => ({
  readSetting: (key: string, fallback: any) => calls.stored.get(key) ?? fallback,
  storeSetting: (key: string, value: any) => calls.stored.set(key, value),
}));
vi.mock('../src/services/stt/voskModelDownloader', () => ({ VOSK_MODELS: [], downloadVoskModel: async () => 'vosk' }));
vi.mock('../src/services/stt/whisperModelDownloader', () => ({ WHISPER_MODELS: [], downloadWhisperModel: async () => 'whisper' }));
vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('../src/utils/fileSystemAdapter', () => ({
  Directory: { Data: 'DATA' },
  FileSystemAdapter: { mkdir: async () => undefined },
}));
vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({ downloadModel: async () => ({ path: 'x' }) }) }));

import { setupService } from '../src/services/setupService';

const manifest = {
  models: [
    { id: 'qwen3.5-2b', name: 'Qwen', category: 'GGUF', path: 'models/GGUF/Qwen3.5-2B-Q4_K_M.gguf', target: 'Qwen3.5-2B-Q4_K_M.gguf', size: 1 },
    { id: 'vosk-it', name: 'Vosk IT', category: 'Vosk', path: 'models/Vosk/it.zip', target: 'it.zip', size: 1 },
    { id: 'piper-paola', name: 'Paola', category: 'Piper', path: 'models/Piper/it_IT-paola-medium.onnx', target: 'it_IT-paola-medium.onnx', size: 1 },
    { id: 'vad-silero', name: 'VAD', category: 'VAD', path: 'models/VAD/silero_vad.onnx', target: 'silero_vad.onnx', size: 1 },
    { id: 'speakerid-ecapa', name: 'ECAPA', category: 'SpeakerID', path: 'models/SpeakerID/ecapa_tdnn.onnx', target: 'ecapa_tdnn.onnx', size: 1 },
  ],
};

describe('one-click setup', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('waits for each download, stores files where the app loads them and applies valid ids', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(manifest), { status: 200 })));
    const events: string[] = [];
    vi.stubGlobal('window', Object.assign(new EventTarget(), { localStorage }));
    window.addEventListener('storage', e => events.push((e as StorageEvent).key ?? ''));
    vi.stubGlobal('StorageEvent', class extends Event { key: string; newValue: string; constructor(t: string, i: any) { super(t); this.key = i.key; this.newValue = i.newValue; } });

    await setupService.runOneClickSetup('http://srv/', 'K');

    expect(calls.downloads.every(d => d.waited)).toBe(true);
    expect(calls.downloads.map(d => d.target)).toEqual([
      'Qwen3.5-2B-Q4_K_M.gguf',
      'piper-voices/it_IT-paola-medium.onnx',
      'piper-voices/it_IT-paola-medium.onnx.json',
      'vad-models/silero-vad-v4.onnx',
      'models/ecapa_tdnn.onnx',
    ]);
    expect(calls.stored.get('llm-config')).toMatchObject({ provider: 'native-gguf', engine: 'gguf', nativeModelPath: 'Qwen3.5-2B-Q4_K_M.gguf' });
    expect(calls.stored.get('speech-config')).toMatchObject({ sttProvider: 'vosk', ttsProvider: 'piper', piperVoiceId: 'it_IT-paola-medium' });
    expect(events).toContain('llm-config');
    expect(setupService.getProgress()).toMatchObject({ status: 'completed', percentage: 100 });
  });

  it('does not select a model whose download failed', async () => {
    calls.downloads.length = 0;
    calls.stored.clear();
    calls.failUrl = 'http://srv/dl/models/GGUF/Qwen3.5-2B-Q4_K_M.gguf';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ models: [manifest.models[0]] }), { status: 200 })));
    vi.stubGlobal('window', Object.assign(new EventTarget(), { localStorage }));

    await setupService.runOneClickSetup('http://srv', 'K');

    expect(calls.stored.has('llm-config')).toBe(false);
    expect(setupService.getProgress().currentStepName).toMatch(/1 failed/);
  });
});
