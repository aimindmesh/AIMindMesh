
import { Capacitor } from '@capacitor/core';
import { logger } from '../logger';
import ProactivePlugin from './ProactivePlugin';

/** Device state measured by the native worker at each check (missing on older native builds) */
export interface ProactiveCheckDetail {
    timestamp: number;
    /** Id the native worker waits on: acknowledged when every listener is done */
    checkId?: string;
    screenOn?: boolean;
    charging?: boolean;
    /** System Do Not Disturb */
    dnd?: boolean;
    /** Native availability score (0-100) */
    score?: number;
}

type CheckListener = (detail: ProactiveCheckDetail) => void | Promise<void>;

export class BackgroundServicePlugin {
    private listeners: CheckListener[] = [];

    constructor() {
        this.init();
    }

    private init() {
        if (typeof window !== 'undefined') {
            window.addEventListener('proactiveCheck', (event: any) => {
                const detail: ProactiveCheckDetail = { ...(event.detail || {}), timestamp: event.detail?.timestamp || Date.now() };
                logger.log('info', `[BackgroundServicePlugin] Received proactive check at ${detail.timestamp}`);
                void this.dispatch(detail);
            });
        }
    }

    addListener(callback: CheckListener) {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(cb => cb !== callback);
        };
    }

    /** Runs every listener, then tells the native worker it may finish (it keeps the process awake until then). */
    async dispatch(detail: ProactiveCheckDetail): Promise<void> {
        await Promise.allSettled(this.listeners.map(cb => Promise.resolve().then(() => cb(detail))));
        if (detail.checkId && Capacitor.isNativePlatform()) {
            await ProactivePlugin.checkDone({ checkId: detail.checkId })
                .catch(e => logger.log('debug', '[BackgroundServicePlugin] checkDone failed', e));
        }
    }
}

export const backgroundServicePlugin = new BackgroundServicePlugin();
