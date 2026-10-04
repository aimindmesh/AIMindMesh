import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ reset: vi.fn(async () => {}) }));

vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('../src/services/llm/nativeLLM', () => ({ resetNativeContext: mocks.reset }));
vi.mock('@capacitor/core', async (importOriginal) => {
    const actual: any = await importOriginal();
    return { ...actual, Capacitor: { ...actual.Capacitor, isNativePlatform: () => true } };
});

import { syncGGUFContext } from '../src/services/llm/providers/GGUF/contextSync';

describe('GGUF native context between turns', () => {
    beforeEach(() => mocks.reset.mockClear());

    it('keeps the KV cache for chat turns: the native prefix reuse skips what was already processed', async () => {
        for (let turn = 0; turn < 5; turn++) await syncGGUFContext('chat');
        expect(mocks.reset).not.toHaveBeenCalled();
    });

    it('resets only for prompts with images (that path does not track the prefix)', async () => {
        await syncGGUFContext('chat', { hasImages: true });
        expect(mocks.reset).toHaveBeenCalledWith('chat');
    });
});
