import { Capacitor, registerPlugin } from '@capacitor/core';
import { logger } from '../logger';

interface BundledModelsPlugin {
    getStatus(): Promise<{ status: 'not_started' | 'running' | 'ready' | 'failed'; error?: string }>;
}

const BundledModels = registerPlugin<BundledModelsPlugin>('BundledModels');

let ready: Promise<void> | null = null;

/**
 * Resolves once the models bundled in the APK are unpacked (about a minute on first launch).
 * Loading a model before that would find it missing or half-written.
 */
export function waitForBundledModels(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return Promise.resolve();
    if (!ready) {
        ready = (async () => {
            for (let i = 0; ; i++) {
                const { status, error } = await BundledModels.getStatus();
                if (status === 'ready') return;
                if (status === 'failed') throw new Error(`Bundled models could not be unpacked: ${error ?? 'unknown error'}`);
                if (i === 0) logger.log('info', 'Waiting for bundled models to be unpacked...');
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        })();
        ready.catch(() => { ready = null; }); // allow a retry after a failure
    }
    return ready;
}
