import { beforeEach, describe, expect, it, vi } from 'vitest';

// Fake engines: what is "in RAM" and the order of unloads
const ram = vi.hoisted(() => ({ loaded: new Set<string>(), unloads: [] as string[] }));
const unload = (engine: string) => async () => { ram.loaded.delete(engine); ram.unloads.push(engine); };

vi.mock('../src/services/llm/nativeLLM', () => ({
  getLoadedSlots: () => (ram.loaded.has('gguf') ? ['chat'] : []),
  forceReleaseAllContexts: unload('gguf'),
}));
vi.mock('../src/services/llm/providers/liteRT/plugin', () => ({
  isLiteRTLoaded: async () => ram.loaded.has('litert'),
  releaseLiteRTModel: unload('litert'),
}));
vi.mock('../src/services/llm/providers/genieProvider', () => ({
  isGenieModelLoaded: async () => ram.loaded.has('genie'),
  unloadGenieModel: unload('genie'),
}));
vi.mock('../src/services/image/imageGenService', () => ({
  imageGenService: { isModelLoaded: async () => ram.loaded.has('sd'), unloadModel: unload('sd') },
}));
vi.mock('../src/services/stt/whisperSTT', () => ({
  getWhisperSTTService: () => ({ isModelLoaded: () => ram.loaded.has('whisper'), unloadModel: unload('whisper') }),
}));
vi.mock('../src/services/stt/voxtralSTT', () => ({
  getVoxtralSttService: () => ({ checkModelLoaded: () => ram.loaded.has('voxtral'), unloadModel: unload('voxtral') }),
}));

import {
  ModelBusyError, enterActivity, ensureResident, getActivity, isHeavyWhisperModel, leaveActivity, pin,
  registerLlmRestorer, releaseForMemoryPressure, resetModelOrchestratorForTests,
} from '../src/services/model/modelOrchestrator';
import { localLlmEngine, voiceCallMemoryConflict } from '../src/services/model/llmPreloader';

/** Simulates a service loading its model through the orchestrator */
async function load(engine: any, options?: { heavy?: boolean }) {
  await ensureResident(engine, options);
  ram.loaded.add(engine);
}

beforeEach(() => {
  resetModelOrchestratorForTests();
  ram.loaded.clear();
  ram.unloads = [];
});

describe('model orchestrator', () => {
  it('Stable Diffusion never shares the RAM with an LLM', async () => {
    await load('gguf');
    await load('sd');
    expect([...ram.loaded]).toEqual(['sd']);
    await load('gguf');
    expect([...ram.loaded]).toEqual(['gguf']);
  });

  it('switching LLM engine frees the previous one', async () => {
    await load('gguf');
    await load('litert');
    expect([...ram.loaded]).toEqual(['litert']);
    await load('genie');
    expect([...ram.loaded]).toEqual(['genie']);
  });

  it('a small Whisper stays next to the LLM, a large one replaces it', async () => {
    await load('gguf');
    await load('whisper', { heavy: false });
    expect(ram.loaded).toEqual(new Set(['gguf', 'whisper']));

    await load('whisper', { heavy: true });
    expect([...ram.loaded]).toEqual(['whisper']);
    expect(ram.unloads).toEqual(['gguf']);
  });

  it('image screen: open frees the LLM, close frees SD and brings the LLM back', async () => {
    const restorer = vi.fn(async () => { await load('gguf'); });
    registerLlmRestorer(restorer);
    await load('gguf');

    await enterActivity('image', ['sd']);
    expect(ram.loaded.has('gguf')).toBe(false);
    expect(getActivity()).toBe('image');
    await load('sd');

    await leaveActivity('image');
    await vi.waitFor(() => expect(restorer).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect([...ram.loaded]).toEqual(['gguf']));
    expect(getActivity()).toBe('chat');
  });

  it('nested sessions of the same activity leave only at the last one', async () => {
    registerLlmRestorer(vi.fn(async () => {}));
    await enterActivity('image', ['sd']);
    await enterActivity('image', ['sd']);
    await load('sd');
    await leaveActivity('image');
    expect(ram.loaded.has('sd')).toBe(true);
    await leaveActivity('image');
    expect(ram.loaded.has('sd')).toBe(false);
  });

  it('a pinned model (recording) is never unloaded: the conflicting load fails instead', async () => {
    await load('voxtral');
    const unpin = pin('voxtral');
    await expect(ensureResident('gguf')).rejects.toBeInstanceOf(ModelBusyError);
    expect(ram.loaded.has('voxtral')).toBe(true);

    unpin();
    await load('gguf');
    expect([...ram.loaded]).toEqual(['gguf']);
  });

  it('memory pressure: idle frees what the activity does not need, all frees everything not pinned', async () => {
    ram.loaded.add('gguf');
    ram.loaded.add('sd');
    await releaseForMemoryPressure('idle'); // chat keeps the LLM
    expect([...ram.loaded]).toEqual(['gguf']);

    await load('whisper', { heavy: false });
    const unpin = pin('whisper');
    await releaseForMemoryPressure('all');
    expect([...ram.loaded]).toEqual(['whisper']);
    unpin();
  });

  it('transitions run one at a time, in order', async () => {
    ram.loaded.add('gguf');
    await Promise.all([load('sd'), load('litert'), load('voxtral')]);
    expect(ram.unloads).toEqual(['gguf', 'sd', 'litert']);
    expect([...ram.loaded]).toEqual(['voxtral']);
  });

  it('classifies Whisper models by size', () => {
    expect(isHeavyWhisperModel('ggml-medium')).toBe(true);
    expect(isHeavyWhisperModel('ggml-large-v3-turbo')).toBe(true);
    expect(isHeavyWhisperModel('ggml-base')).toBe(false);
    expect(isHeavyWhisperModel('ggml-small.en')).toBe(false);
  });
});

describe('chat model and voice calls', () => {
  it('knows which local engine a config uses', () => {
    expect(localLlmEngine({ provider: 'native-gguf', nativeModelPath: 'm.gguf' } as any)).toBe('gguf');
    expect(localLlmEngine({ provider: 'native-gguf', engine: 'litert', liteRTModelPath: 'g.litertlm' } as any)).toBe('litert');
    expect(localLlmEngine({ provider: 'genie-npu', nativeModelPath: 'x' } as any)).toBe('genie');
    expect(localLlmEngine({ provider: 'gemini' } as any)).toBeNull();
    expect(localLlmEngine({ provider: 'aimindmesh-server' } as any)).toBeNull();
  });

  it('refuses a heavy speech model in a call with an on-device LLM only', () => {
    localStorage.setItem('llm-config', JSON.stringify({ provider: 'native-gguf', nativeModelPath: 'm.gguf' }));
    expect(voiceCallMemoryConflict('voxtral')).toMatch(/do not fit in RAM/);
    expect(voiceCallMemoryConflict('whisper', 'ggml-medium')).toMatch(/do not fit in RAM/);
    expect(voiceCallMemoryConflict('whisper', 'ggml-base')).toBeNull();
    expect(voiceCallMemoryConflict('vosk')).toBeNull();

    localStorage.setItem('aimindmesh-server-settings', JSON.stringify({ enabled: true, useAsDefaultProvider: true }));
    expect(voiceCallMemoryConflict('voxtral')).toBeNull(); // the answer comes from the server

    localStorage.removeItem('aimindmesh-server-settings');
    localStorage.setItem('llm-config', JSON.stringify({ provider: 'gemini' }));
    expect(voiceCallMemoryConflict('voxtral')).toBeNull();
  });
});
