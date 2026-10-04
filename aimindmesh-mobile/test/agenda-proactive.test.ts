import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  analyze: vi.fn(),
  execute: vi.fn(async () => {}),
  checkPermission: vi.fn(async () => ({ allowed: true })),
  updateSettings: vi.fn(async () => {}),
  startService: vi.fn(async () => {}),
  stopService: vi.fn(async () => {}),
}));

vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('../src/services/proactive/ContextAnalyzer', () => ({ contextAnalyzer: { analyze: mocks.analyze } }));
vi.mock('../src/services/proactive/PermissionManager', () => ({ permissionManager: { checkPermission: mocks.checkPermission } }));
vi.mock('../src/services/proactive/ActionExecutor', () => ({
  actionExecutor: { execute: mocks.execute },
  onProactiveAction: vi.fn(() => () => {}),
}));
vi.mock('../src/services/proactive/ProactiveNotificationService', () => ({ proactiveNotificationService: { init: vi.fn(async () => {}), updateSettings: vi.fn(async () => {}) } }));
vi.mock('../src/services/proactive/ProactivePlugin', () => ({
  default: { updateSettings: mocks.updateSettings, startService: mocks.startService, stopService: mocks.stopService },
}));
vi.mock('@capacitor/core', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, Capacitor: { ...actual.Capacitor, isNativePlatform: () => true } };
});

import { countDeliveredActions } from '../src/services/proactive/ActivityLogger';
import { getEventsPendingBriefing, markEventBriefed, toBriefingEvents, CHECK_PERIOD_MINUTES } from '../src/services/proactive/meetingBriefingService';
import { syncNativeProactiveSettings, resetNativeProactiveSync } from '../src/services/proactive/nativeProactiveSync';
import { DEFAULT_PROACTIVE_SETTINGS, ProactiveActionType } from '../src/types/proactive';

const MIN = 60 * 1000;
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0)); };

const context = (over: { battery?: number; overdue?: number; events?: any[] } = {}) => ({
  timestamp: Date.now(),
  device: { batteryLevel: over.battery ?? 0.9, isCharging: false, networkType: 'wifi', isPowerSaveMode: false, platform: 'android' },
  user: { activity: 'active', lastInteraction: Date.now() },
  app: { focusMode: false },
  data: { recentMemories: [], upcomingEvents: over.events ?? [], overdueTasks: Array(over.overdue ?? 0).fill({}), upcomingTasks: [], recentChatHistory: [], memoryCount: 0 },
  chat: { messageCount: 0, contextUsage: 0 },
});

beforeEach(() => {
  localStorage.setItem('proactive-settings', JSON.stringify(DEFAULT_PROACTIVE_SETTINGS));
  mocks.execute.mockClear();
});

describe('hourly rate limit counting', () => {
  it('counts each delivered action once and never the blocked ones', () => {
    const e = (actionId: string, status: string, timestamp = 100) =>
      ({ actionId, actionType: 'x', timestamp, status, dismissed: false, interacted: false });
    const log = [
      e('a', 'executing'), e('a', 'completed'), // one action, two rows
      e('b', 'pending'),
      e('c', 'ignored'), e('d', 'ignored'),     // blocked: quiet hours, rate limit...
      e('old', 'completed', 10),
    ];
    expect(countDeliveredActions(log, 50)).toBe(2);
  });
});

describe('meeting briefing', () => {
  it('reads agenda events (startTime: Date) and skips all-day ones', () => {
    const start = new Date(2026, 9, 3, 10, 0);
    expect(toBriefingEvents([
      { id: 'e1', title: 'Standup', startTime: start, endTime: new Date(start.getTime() + 30 * MIN) },
      { id: 'e2', title: 'Holiday', startTime: start, isAllDay: true },
    ])).toEqual([{ id: 'e1', title: 'Standup', start: start.getTime(), end: start.getTime() + 30 * MIN, location: undefined, notes: undefined }]);
  });

  it('catches every event with checks one period apart, once even after a restart', () => {
    const now = 1_000 * MIN;
    const lead = 5;
    // Starts in lead + period: the next check would be too late, so this one takes it
    const event = { id: 'm1', title: 'Review', start: now + (lead + CHECK_PERIOD_MINUTES) * MIN };
    expect(getEventsPendingBriefing([event], lead, now)).toHaveLength(1);
    expect(getEventsPendingBriefing([{ ...event, start: now + (lead + CHECK_PERIOD_MINUTES + 1) * MIN }], lead, now)).toHaveLength(0);
    expect(getEventsPendingBriefing([{ ...event, start: now - MIN }], lead, now)).toHaveLength(0);

    markEventBriefed('m1', now);
    expect(getEventsPendingBriefing([event], lead, now)).toHaveLength(0); // persisted in localStorage
  });
});

describe('native proactive settings', () => {
  it('hands the settings to the native side and starts/stops the job only when enabled changes', async () => {
    resetNativeProactiveSync();
    await syncNativeProactiveSettings(DEFAULT_PROACTIVE_SETTINGS);
    expect(mocks.updateSettings).toHaveBeenCalledWith({ settings: JSON.stringify(DEFAULT_PROACTIVE_SETTINGS) });
    expect(mocks.startService).toHaveBeenCalledTimes(1);

    await syncNativeProactiveSettings({ ...DEFAULT_PROACTIVE_SETTINGS, aggressiveness: 'minimal' });
    expect(mocks.startService).toHaveBeenCalledTimes(1);

    await syncNativeProactiveSettings({ ...DEFAULT_PROACTIVE_SETTINGS, enabled: false });
    expect(mocks.stopService).toHaveBeenCalledTimes(1);
  });
});

/** A fresh service listening on a fresh window: earlier instances keep their own listeners */
async function freshService() {
  (globalThis as any).window = Object.assign(new EventTarget(), { localStorage });
  vi.resetModules();
  const { proactiveService } = await import('../src/services/proactive/ProactiveService');
  await proactiveService.init();
  return proactiveService;
}

describe('proactive suggestions', () => {
  it('runs each check once, across server online/offline cycles', async () => {
    const proactiveService = await freshService();
    for (let i = 0; i < 3; i++) {
      proactiveService.enableServerMode({} as any);
      proactiveService.disableServerMode();
    }
    mocks.analyze.mockClear().mockResolvedValue(context());
    window.dispatchEvent(new CustomEvent('proactiveCheck', { detail: { timestamp: 1 } }));
    await flush();
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
  });

  it('accepting a card neither brings it back nor shows it again at the next check', async () => {
    const proactiveService = await freshService();
    mocks.analyze.mockResolvedValue(context({ overdue: 2, battery: 0.1 }));

    window.dispatchEvent(new CustomEvent('proactiveCheck', { detail: { timestamp: 1 } }));
    await flush();
    window.dispatchEvent(new CustomEvent('proactiveCheck', { detail: { timestamp: 2 } }));
    await flush();
    // One card per kind, not one per check
    expect(proactiveService.getSuggestions().map(s => s.type).sort()).toEqual(
      [ProactiveActionType.SUGGEST_OPTIMIZATION, ProactiveActionType.SUGGEST_TASK_REVIEW].sort()
    );

    const opened: string[] = [];
    window.addEventListener('shortcutAction', (e: any) => opened.push(e.detail));
    const review = proactiveService.getSuggestions().find(s => s.type === ProactiveActionType.SUGGEST_TASK_REVIEW)!;
    await proactiveService.acceptSuggestion(review);
    expect(opened).toEqual(['kanban']);
    expect(mocks.execute).not.toHaveBeenCalled();

    const battery = proactiveService.getSuggestions().find(s => s.type === ProactiveActionType.SUGGEST_OPTIMIZATION)!;
    proactiveService.dismissSuggestion(battery.id);

    window.dispatchEvent(new CustomEvent('proactiveCheck', { detail: { timestamp: 3 } }));
    await flush();
    expect(proactiveService.getSuggestions()).toHaveLength(0);
  });

  it('removes the battery card once charging', async () => {
    const proactiveService = await freshService();
    mocks.analyze.mockResolvedValue(context({ battery: 0.1 }));
    window.dispatchEvent(new CustomEvent('proactiveCheck', { detail: { timestamp: 1 } }));
    await flush();
    expect(proactiveService.getSuggestions()).toHaveLength(1);

    mocks.analyze.mockResolvedValue({ ...context({ battery: 0.1 }), device: { ...context().device, batteryLevel: 0.1, isCharging: true } });
    window.dispatchEvent(new CustomEvent('proactiveCheck', { detail: { timestamp: 2 } }));
    await flush();
    expect(proactiveService.getSuggestions()).toHaveLength(0);
  });

  it('hands an upcoming meeting to the chat once', async () => {
    await freshService();
    const event = { id: `ev-${Math.random()}`, title: 'Budget', start: Date.now() + 10 * MIN };
    mocks.analyze.mockResolvedValue(context({ events: [event] }));

    window.dispatchEvent(new CustomEvent('proactiveCheck', { detail: { timestamp: 1 } }));
    await flush();
    window.dispatchEvent(new CustomEvent('proactiveCheck', { detail: { timestamp: 2 } }));
    await flush();
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const action = (mocks.execute.mock.calls[0] as any)[0];
    expect(action.type).toBe(ProactiveActionType.CHAT_MEETING_BRIEFING);
    expect(action.category).toBe('interactive');
    expect(action.data.eventStart).toBe(event.start);
  });
});
