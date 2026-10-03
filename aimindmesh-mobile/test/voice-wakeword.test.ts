import { describe, expect, it, vi } from 'vitest';

const plugin = vi.hoisted(() => {
    const listeners: Record<string, (data: any) => void> = {};
    const state = { nativeListening: false };
    return {
        listeners,
        state,
        addListener: vi.fn(async (event: string, fn: (data: any) => void) => {
            listeners[event] = fn;
            return { remove: vi.fn(async () => {}) };
        }),
        loadModel: vi.fn(async ({ modelName }: { modelName: string }) => ({ loaded: true, modelName })),
        startListening: vi.fn(async () => {
            state.nativeListening = true;
            return { status: 'listening' };
        }),
        stopListening: vi.fn(async () => { state.nativeListening = false; }),
        isListening: vi.fn(async () => ({ listening: state.nativeListening })),
    };
});

vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('wakeword-capacitor', () => ({ OpenWakeWord: plugin }));

import { WakeWordService } from '../src/services/wakeword/wakeWordService';

describe('wake word service state sync', () => {
    it('restarts when the native service stopped behind its back', async () => {
        const service = new WakeWordService();
        await service.loadModel({ modelName: 'hey_jarvis_v0.1.tflite' });
        expect(await service.startListening()).toBe(true);

        // e.g. the training wizard or the notification "Stop" ended the native service
        plugin.state.nativeListening = false;
        expect(await service.startListening()).toBe(true);
        expect(plugin.startListening).toHaveBeenCalledTimes(2);
    });

    it('follows native listening-state events', async () => {
        const service = new WakeWordService();
        await service.loadModel({ modelName: 'hey_jarvis_v0.1.tflite' });
        const states: boolean[] = [];
        service.onStateChange(s => states.push(s));

        plugin.listeners.listeningStateChanged({ isListening: true });
        plugin.listeners.listeningStateChanged({ isListening: false });
        expect(states).toEqual([true, false]);
        expect(service.isListening()).toBe(false);
    });

    it('always forwards stop to native, even with a stale local flag', async () => {
        const service = new WakeWordService();
        await service.loadModel({ modelName: 'hey_jarvis_v0.1.tflite' });
        plugin.stopListening.mockClear();
        await service.stopListening();
        expect(plugin.stopListening).toHaveBeenCalledTimes(1);
    });
});
