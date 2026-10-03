import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('../src/services/worker/NodeWorker', () => ({ nodeWorker: { connect: vi.fn() } }));
vi.mock('../src/services/memory/memoryDatabase', () => ({ getRecentMemories: vi.fn(), getMemoryCount: vi.fn() }));
vi.mock('../src/services/calendar/calendarService', () => ({ getAllEvents: vi.fn(), systemCalendarVisible: vi.fn() }));
vi.mock('../src/services/calendar/taskDatabase', () => ({ getUpcomingTasks: vi.fn(), getOverdueTasks: vi.fn() }));

import { calendarEventSyncId } from '../src/services/calendar';
import { buildAutoCalendarPayload } from '../src/services/androidAuto/androidAutoService';
import { isQuietHoursActive, toFractionalHour } from '../src/services/fcmService';
import { AiTaskService } from '../src/services/calendar/AiTaskService';
import { getContextWindow } from '../src/services/proactive/ContextAnalyzer';

afterEach(() => vi.unstubAllGlobals());

describe('calendar sync ids', () => {
  it('uses the calendar id, so events with the same start stay distinct', () => {
    const midnight = new Date(2026, 9, 3);
    const birthday = { id: '41', title: 'Birthday', startDate: midnight, endDate: midnight };
    const holiday = { id: '42', title: 'Holiday', startDate: midnight, endDate: midnight };
    expect(calendarEventSyncId('dev', birthday)).toBe('dev_41');
    expect(calendarEventSyncId('dev', birthday)).not.toBe(calendarEventSyncId('dev', holiday));
    // Without an id (older plugin data) the title still separates them
    expect(calendarEventSyncId('dev', { ...birthday, id: undefined }))
      .not.toBe(calendarEventSyncId('dev', { ...holiday, id: undefined }));
  });
});

describe('Android Auto calendar payload', () => {
  it('dates the events of other days and shows all-day events without times', () => {
    const now = new Date(2026, 9, 3, 8, 0);
    const payload = JSON.parse(buildAutoCalendarPayload([
      { title: 'Standup', startTime: new Date(2026, 9, 3, 9, 0), endTime: new Date(2026, 9, 3, 9, 15) },
      { title: 'Trip', startTime: new Date(2026, 9, 5, 0, 0), endTime: new Date(2026, 9, 5, 23, 59), isAllDay: true, location: 'Rome' },
      { title: 'Dentist', startTime: new Date(2026, 9, 6, 17, 0), endTime: new Date(2026, 9, 6, 18, 0) },
    ], now));

    expect(payload[0].startTime).not.toMatch(/\s.*\s/); // today: time only
    expect(payload[1].startTime).toMatch(/All day$/);
    expect(payload[1].endTime).toBe('');
    expect(payload[1].description).toBe('Rome');
    expect(payload[2].startTime.length).toBeGreaterThan(payload[0].startTime.length); // date prefix
  });
});

describe('FCM quiet hours', () => {
  const setQuietHours = (start: unknown, end: unknown) =>
    localStorage.setItem('proactive-settings', JSON.stringify({ quietHours: { enabled: true, start, end } }));

  it('reads the hour numbers the settings store (and older "HH:MM" strings)', () => {
    expect(toFractionalHour(22, 0)).toBe(22);
    expect(toFractionalHour('07:30', 0)).toBe(7.5);
    expect(toFractionalHour(undefined, 8)).toBe(8);

    setQuietHours(22, 7);
    expect(isQuietHoursActive(new Date(2026, 9, 3, 23, 0))).toBe(true);
    expect(isQuietHoursActive(new Date(2026, 9, 3, 6, 59))).toBe(true);
    expect(isQuietHoursActive(new Date(2026, 9, 3, 12, 0))).toBe(false);

    setQuietHours('09:00', '17:00');
    expect(isQuietHoursActive(new Date(2026, 9, 3, 10, 0))).toBe(true);
  });
});

describe('AI task deletion on the server', () => {
  it('queues a failed deletion and retries it with the next call', async () => {
    localStorage.setItem('aimindmesh-server-settings', JSON.stringify({ enabled: true, serverUrl: 'http://srv/' }));
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    await AiTaskService.deleteTask('task_1');
    expect(fetchMock).toHaveBeenCalledWith('http://srv/api/ai-tasks/task_1', expect.objectContaining({ method: 'DELETE' }));
    expect(JSON.parse(localStorage.getItem('ai-task-pending-deletes')!)).toEqual(['task_1']);

    await AiTaskService.deleteTask('task_2');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(localStorage.getItem('ai-task-pending-deletes')).toBeNull();
  });

  it('keeps the deletion for later while the server is disabled', async () => {
    localStorage.setItem('aimindmesh-server-settings', JSON.stringify({ enabled: false }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await AiTaskService.deleteTask('task_3');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('ai-task-pending-deletes')!)).toEqual(['task_3']);
  });
});

describe('context window for auto-summarization', () => {
  it('uses the remote provider window, the on-device setting otherwise', () => {
    expect(getContextWindow({ provider: 'gemini', nCtx: 2048 })).toBe(1_000_000);
    expect(getContextWindow({ provider: 'native-gguf', nCtx: 4096 })).toBe(4096);
    expect(getContextWindow(null)).toBe(2048);
  });
});
