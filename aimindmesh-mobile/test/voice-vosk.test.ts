import { beforeEach, describe, expect, it, vi } from 'vitest';

const vosk = vi.hoisted(() => {
    const listeners: Record<string, ((data: any) => void)[]> = {};
    const plugin = {
        listeners,
        permission: 'granted' as string,
        requestResult: 'granted' as string,
        startGate: null as null | Promise<void>,
        checkPermissions: vi.fn(async () => ({ microphone: plugin.permission })),
        requestPermissions: vi.fn(async () => ({ microphone: plugin.requestResult })),
        loadModel: vi.fn(async () => {}),
        unloadModel: vi.fn(async () => {}),
        startRecognition: vi.fn(async () => {
            if (plugin.startGate) await plugin.startGate;
        }),
        stopRecognition: vi.fn(async () => {}),
        addListener: vi.fn(async (event: string, fn: (data: any) => void) => {
            (listeners[event] ||= []).push(fn);
            return {
                remove: vi.fn(async () => {
                    listeners[event] = (listeners[event] || []).filter(l => l !== fn);
                }),
            };
        }),
    };
    return plugin;
});

vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('vosk-capacitor', () => ({ Vosk: vosk }));

import { VoskSpeechToTextService } from '../src/services/stt/voskSTT';

const listenerCount = () => Object.values(vosk.listeners).reduce((n, l) => n + l.length, 0);

describe('Vosk STT service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        for (const key of Object.keys(vosk.listeners)) delete vosk.listeners[key];
        vosk.permission = 'granted';
        vosk.requestResult = 'granted';
        vosk.startGate = null;
    });

    it('requests the microphone permission and fails cleanly when denied', async () => {
        const service = new VoskSpeechToTextService();
        await service.loadModel('vosk-model-it-0.22');
        vosk.permission = 'prompt';
        vosk.requestResult = 'denied';

        await expect(service.start(vi.fn())).rejects.toThrow(/permission/i);
        expect(vosk.requestPermissions).toHaveBeenCalled();
        expect(vosk.startRecognition).not.toHaveBeenCalled();
        expect(service.isRunning()).toBe(false);
        expect(listenerCount()).toBe(0);
    });

    it('undoes a start that a stop overtook while the recorder was starting', async () => {
        const service = new VoskSpeechToTextService();
        await service.loadModel('vosk-model-it-0.22');
        let release!: () => void;
        vosk.startGate = new Promise<void>(r => { release = r; });
        const onUpdate = vi.fn();

        const starting = service.start(onUpdate);
        await vi.waitFor(() => expect(vosk.startRecognition).toHaveBeenCalled());
        await service.stop();
        release();
        await starting;

        // Stopped again once the native recorder actually existed, and no listener survives
        expect(vosk.stopRecognition).toHaveBeenCalledTimes(2);
        expect(listenerCount()).toBe(0);
        expect(service.isRunning()).toBe(false);
    });

    it('accumulates final results per session', async () => {
        const service = new VoskSpeechToTextService();
        await service.loadModel('vosk-model-it-0.22');
        const onUpdate = vi.fn();
        await service.start(onUpdate);
        vosk.listeners.finalResult[0]({ text: 'ciao' });
        vosk.listeners.partialResult[0]({ text: 'come' });
        expect(onUpdate).toHaveBeenLastCalledWith('ciao come');

        await service.stop();
        expect(listenerCount()).toBe(0);

        const next = vi.fn();
        await service.start(next);
        vosk.listeners.finalResult[0]({ text: 'nuovo' });
        expect(next).toHaveBeenLastCalledWith('nuovo');
    });
});
