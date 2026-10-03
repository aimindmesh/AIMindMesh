import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  initializeNativeModel: vi.fn(async () => ({ supportsVision: false })),
  initNativeModel: vi.fn(async () => {}),
  unloadNativeModelSlot: vi.fn(async () => {}),
  toolLoaded: false,
  initLiteRTModel: vi.fn(async () => true),
  initGenieModel: vi.fn(async () => true),
  unloadEngines: vi.fn(async () => {}),
}));

vi.mock('../src/services/llm/providers/GGUF/initialization', () => ({ initializeNativeModel: m.initializeNativeModel }));
vi.mock('../src/services/llm/nativeLLM', () => ({
  initNativeModel: m.initNativeModel,
  unloadNativeModelSlot: m.unloadNativeModelSlot,
  getSlotModelInfo: () => ({ isLoaded: m.toolLoaded, modelPath: m.toolLoaded ? 'old-tool.gguf' : null }),
}));
vi.mock('../src/services/llm/providers/liteRT/plugin', () => ({ initLiteRTModel: m.initLiteRTModel }));
vi.mock('../src/services/llm/providers/genieProvider', () => ({ initGenieModel: m.initGenieModel }));
vi.mock('../src/utils/fileSystemAdapter', () => ({
  Directory: { Data: 'DATA' },
  FileSystemAdapter: { getUri: async ({ path }: { path: string }) => ({ uri: `file:///data/${path}` }) },
}));
vi.mock('../src/services/model/modelOrchestrator', async (original) => ({
  ...(await original<typeof import('../src/services/model/modelOrchestrator')>()),
  unloadEngines: m.unloadEngines,
}));

import { preloadConfiguredLLM } from '../src/services/model/llmPreloader';

beforeEach(() => {
  vi.clearAllMocks();
  m.toolLoaded = false;
});

describe('preloading the configured chat model', () => {
  it('a cloud/server provider loads nothing and frees any local LLM', async () => {
    await preloadConfiguredLLM({ provider: 'gemini' } as any);
    expect(m.unloadEngines).toHaveBeenCalledWith(['gguf', 'litert', 'genie'], expect.any(String));
    expect(m.initializeNativeModel).not.toHaveBeenCalled();
  });

  it('GGUF goes through the provider init; the dedicated tool model follows its setting', async () => {
    const config = { provider: 'native-gguf', nativeModelPath: 'chat.gguf', useDedicatedToolModel: true, toolUseModelPath: 'tool.gguf' } as any;
    await preloadConfiguredLLM(config);
    expect(m.initializeNativeModel).toHaveBeenCalledWith(config);
    expect(m.initNativeModel).toHaveBeenCalledWith(expect.objectContaining({ modelPath: 'tool.gguf' }), 'tool');

    m.toolLoaded = true;
    vi.clearAllMocks();
    await preloadConfiguredLLM({ ...config, useDedicatedToolModel: false });
    expect(m.unloadNativeModelSlot).toHaveBeenCalledWith('tool');
  });

  it('LiteRT and Genie load their own model only', async () => {
    await preloadConfiguredLLM({ provider: 'native-gguf', engine: 'litert', liteRTModelPath: 'g.litertlm' } as any);
    expect(m.initLiteRTModel).toHaveBeenCalledWith(expect.objectContaining({ modelPath: '/data/g.litertlm' }));
    expect(m.initializeNativeModel).not.toHaveBeenCalled();

    await preloadConfiguredLLM({ provider: 'genie-npu', nativeModelPath: 'npu-model' } as any);
    expect(m.initGenieModel).toHaveBeenCalledWith('npu-model', expect.anything());
  });
});
