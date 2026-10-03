import { beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({
  isRunning: vi.fn(async () => ({ running: false })),
  startService: vi.fn(async () => { }),
  stopService: vi.fn(async () => { })
}));

vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'android' } }));
vi.mock('background-service-capacitor', () => ({ default: service }));

import { startMeetingForegroundService, stopMeetingForegroundService } from '../src/services/meeting/meetingForegroundService';

beforeEach(() => vi.clearAllMocks());

describe('meeting foreground service', () => {
  it('starts the service for the recording and stops it afterwards', async () => {
    await startMeetingForegroundService();
    expect(service.startService).toHaveBeenCalledTimes(1);
    await stopMeetingForegroundService();
    expect(service.stopService).toHaveBeenCalledTimes(1);
  });

  it('restarts a keep-alive service (microphone type) but leaves it running', async () => {
    service.isRunning.mockResolvedValueOnce({ running: true });
    await startMeetingForegroundService();
    expect(service.startService).toHaveBeenCalledTimes(1);
    await stopMeetingForegroundService();
    expect(service.stopService).not.toHaveBeenCalled();
  });
});
