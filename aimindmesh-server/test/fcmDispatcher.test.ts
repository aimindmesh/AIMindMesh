import { describe, expect, it } from 'vitest';
import { buildFcmMessage } from '../src/services/FCMDispatcher';

describe('FCM message shape', () => {
  it('sends control messages data-only, so a backgrounded app still receives them', () => {
    for (const type of ['WAKE_FOR_INFERENCE', 'SYNC_REQUEST']) {
      const message: any = buildFcmMessage('tok', { title: 'Synaptic Link', body: 'Waking up node...', data: { type, taskId: 't1' } });
      expect(message.notification).toBeUndefined();
      expect(message.data).toEqual({ type, taskId: 't1', title: 'Synaptic Link', body: 'Waking up node...' });
      expect(message.android).toEqual({ priority: 'high' });
    }
  });

  it('keeps the notification block for user-facing messages', () => {
    const message: any = buildFcmMessage('tok', { title: 'Insight', body: 'Text', data: { type: 'NEW_INSIGHT', insightId: 'i1' } });
    expect(message.notification).toEqual({ title: 'Insight', body: 'Text' });
    expect(message.data).toEqual({ type: 'NEW_INSIGHT', insightId: 'i1' });
  });

  it('handles a payload without data', () => {
    const message: any = buildFcmMessage('tok', { title: 'T', body: 'B' });
    expect(message).toEqual({ token: 'tok', notification: { title: 'T', body: 'B' }, data: {}, android: { priority: 'high' } });
  });
});
