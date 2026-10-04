import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ wake: vi.fn(), markRead: vi.fn(async () => {}) }));

vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('../src/services/worker/NodeWorker', () => ({ nodeWorker: { wake: mocks.wake } }));
vi.mock('../src/services/feedService', () => ({ markInsightRead: mocks.markRead }));

import { dispatchMessage, onFCMFeedEvent, setFCMSettingsForTests } from '../src/services/fcmService';

const message = (type: string, data: Record<string, string> = {}) => ({ type, title: 'T', body: 'B', data }) as any;

describe('FCM messages from the server', () => {
    beforeEach(() => {
        mocks.wake.mockClear();
        mocks.markRead.mockClear();
        localStorage.removeItem('proactive-settings');
    });

    it('treats every insight push type as a new insight, and debate rounds as thread updates', () => {
        const events: any[] = [];
        const off = onFCMFeedEvent(e => events.push(e));
        dispatchMessage(message('INSIGHT_DELIVERY', { insightId: 'a' }));
        dispatchMessage(message('INSIGHT_FALLBACK', { insightId: 'b' }));
        dispatchMessage(message('NEW_INSIGHT', { insightId: 'c' }));
        dispatchMessage(message('DEBATE_UPDATE', { insightId: 'a', round: '2' }));
        off();
        expect(events.map(e => [e.type, e.insightId])).toEqual([
            ['new_insight', 'a'], ['new_insight', 'b'], ['new_insight', 'c'], ['debate_update', 'a'],
        ]);
    });

    it('tells the server about "Mark Read" and wakes the worker node', () => {
        setFCMSettingsForTests({ enabled: true, serverUrl: 'http://srv', apiKey: 'K' } as any);
        dispatchMessage(message('MARK_READ_ACTION', { insightId: 'x' }));
        expect(mocks.markRead).toHaveBeenCalledWith(expect.objectContaining({ serverUrl: 'http://srv' }), 'x');
        dispatchMessage(message('WAKE_FOR_INFERENCE', { taskId: 't' }));
        expect(mocks.wake).toHaveBeenCalledTimes(1);
        setFCMSettingsForTests(null);
    });
});
