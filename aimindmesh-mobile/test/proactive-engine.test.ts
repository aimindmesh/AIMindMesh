import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    maintenance: vi.fn(),
}));

vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: {} }));
// The real episodic module without its heavy dependencies (LLM providers, SQLite, ONNX)
vi.mock('../src/services/llm/background/backgroundLlm', () => ({ runBackgroundTask: vi.fn() }));
vi.mock('../src/services/memory/memoryDatabase', () => ({ getMemoryDatabase: vi.fn(), deduplicateExistingMemories: vi.fn(), replaceMemoriesAtomically: vi.fn() }));
vi.mock('../src/services/model/embedding/embeddingRuntime', () => ({}));
vi.mock('../src/services/memory/episodicMaintenance', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    runEpisodicMaintenance: mocks.maintenance,
}));

import { permissionManager, isQuietHour } from '../src/services/proactive/PermissionManager';
import { actionExecutor } from '../src/services/proactive/ActionExecutor';
import { activityLogger } from '../src/services/proactive/ActivityLogger';
import { inferActivity } from '../src/services/proactive/ContextAnalyzer';
import { proactiveChannelId } from '../src/services/proactive/ProactiveNotificationService';
import { groupTurns } from '../src/services/memory/episodicMaintenance';
import { DEFAULT_PROACTIVE_SETTINGS, ProactiveActionType, ProactiveAction, categoryOf } from '../src/types/proactive';

const T = ProactiveActionType;

/** A check at 23:30 local time (inside the default 22-7 quiet hours) */
const night = () => { const d = new Date(); d.setHours(23, 30, 0, 0); return d.getTime(); };
const noon = () => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime(); };

const context = (over: { timestamp?: number; network?: string; focus?: boolean } = {}) => ({
    timestamp: over.timestamp ?? noon(),
    device: { batteryLevel: 0.9, isCharging: true, networkType: over.network ?? 'wifi', isPowerSaveMode: false, platform: 'android' },
    user: { activity: 'idle', lastInteraction: 0 },
    app: { focusMode: over.focus ?? false },
    data: { recentMemories: [], upcomingEvents: [], overdueTasks: [], upcomingTasks: [], recentChatHistory: [], memoryCount: 0 },
    chat: { messageCount: 0, contextUsage: 0 },
}) as any;

const settings = (over: Record<string, any> = {}) => localStorage.setItem('proactive-settings', JSON.stringify({
    ...DEFAULT_PROACTIVE_SETTINGS,
    permissions: { ...DEFAULT_PROACTIVE_SETTINGS.permissions, autonomous: true, ...(over.permissions || {}) },
    contextAwareness: { ...DEFAULT_PROACTIVE_SETTINGS.contextAwareness, ...(over.contextAwareness || {}) },
    limits: { ...DEFAULT_PROACTIVE_SETTINGS.limits, ...(over.limits || {}) },
}));

const action = (type: ProactiveActionType, id = `${type}-${Math.random()}`): ProactiveAction => ({
    id, type, category: categoryOf(type), triggeredBy: 'test', triggeredAt: Date.now(), data: { memoryCount: 60 },
    status: 'pending', requiresConfirmation: false, dismissible: true, priority: 4, logLevel: 'info',
});

beforeEach(() => {
    settings();
    mocks.maintenance.mockReset().mockResolvedValue({ deduped: 0, summarized: 0 });
});

describe('permissions', () => {
    it('quiet hours hold back what reaches the user, not the background work', async () => {
        const ctx = context({ timestamp: night() });
        expect((await permissionManager.checkPermission(T.CHAT_CURIOSITY, ctx, 4)).allowed).toBe(false);
        expect((await permissionManager.checkPermission(T.SUGGEST_TASK_REVIEW, ctx, 5)).allowed).toBe(false);
        expect((await permissionManager.checkPermission(T.PERFORM_MEMORY_MAINTENANCE, ctx, 3)).allowed).toBe(true);
        expect((await permissionManager.checkPermission(T.SUMMARIZE_CONTEXT, ctx, 4)).allowed).toBe(true);
        expect(isQuietHour(new Date(night()), { start: 22, end: 7 })).toBe(true);
        expect(isQuietHour(new Date(noon()), { start: 9, end: 17 })).toBe(true);
    });

    it('maintenance needs the autonomous permission, context summaries only their own toggle', async () => {
        settings({ permissions: { autonomous: false } });
        expect((await permissionManager.checkPermission(T.PERFORM_MEMORY_MAINTENANCE, context(), 3)).allowed).toBe(false);
        expect((await permissionManager.checkPermission(T.SUMMARIZE_CONTEXT, context(), 4)).allowed).toBe(true);
    });

    it('applies the daily limits and keeps background work out of the hourly one', async () => {
        settings({ limits: { maxChatMessagesPerDay: 1, maxActionsPerHour: 1, maxAutonomousPerDay: 1 } });
        await activityLogger.log({ ...action(T.PERFORM_MEMORY_MAINTENANCE), status: 'completed' });
        // An autonomous run used the daily autonomous budget, not the hourly one
        expect((await permissionManager.checkPermission(T.PERFORM_MEMORY_MAINTENANCE, context(), 3)).reason).toMatch(/Daily limit/);
        expect((await permissionManager.checkPermission(T.CHAT_CURIOSITY, context(), 4)).allowed).toBe(true);
        await activityLogger.log({ ...action(T.CHAT_CURIOSITY), status: 'completed' });
        expect((await permissionManager.checkPermission(T.CHAT_CURIOSITY, context(), 4)).allowed).toBe(false);
    });

    it('moves heavy maintenance to Wi-Fi and respects Do Not Disturb', async () => {
        expect((await permissionManager.checkPermission(T.PERFORM_MEMORY_MAINTENANCE, context({ network: 'cellular' }), 3)).reason).toMatch(/Wi-Fi/);
        expect((await permissionManager.checkPermission(T.CHAT_CURIOSITY, context({ focus: true }), 4)).allowed).toBe(false);
        expect((await permissionManager.checkPermission(T.PERFORM_MEMORY_MAINTENANCE, context({ focus: true }), 3)).allowed).toBe(true);
    });
});

describe('action executor', () => {
    it('releases the autonomous lock even when a task fails', async () => {
        mocks.maintenance.mockRejectedValueOnce(new Error('model crashed'));
        const first = action(T.PERFORM_MEMORY_MAINTENANCE);
        await actionExecutor.execute(first);
        expect(first.status).toBe('failed');

        const second = action(T.PERFORM_MEMORY_MAINTENANCE);
        await actionExecutor.execute(second);
        expect(second.status).toBe('completed');
        expect(mocks.maintenance).toHaveBeenCalledTimes(2);
    });
});

describe('activity and notifications', () => {
    it('treats a phone with the screen off as idle much sooner', () => {
        const now = 10_000_000;
        expect(inferActivity(now, now - 5 * 60_000, false, true)).toBe('active');
        expect(inferActivity(now, now - 5 * 60_000, false, false)).toBe('idle');
        expect(inferActivity(now, now - 31 * 60_000, false, undefined)).toBe('idle');
        expect(inferActivity(now, now, true, false)).toBe('focus');
    });

    it('gives each notification setting its own Android channel', () => {
        const base = { ...DEFAULT_PROACTIVE_SETTINGS };
        const quiet = { ...base, notifications: { ...base.notifications, sound: false } };
        expect(proactiveChannelId(base, true)).not.toBe(proactiveChannelId(quiet, true));
        expect(proactiveChannelId(base, true)).toMatch(/^proactive-messages-/);
    });
});

describe('episodic maintenance', () => {
    it('groups old chat turns by conversation and day, oldest first', () => {
        const day1 = new Date(2026, 6, 1, 10).getTime();
        const day2 = new Date(2026, 6, 2, 10).getTime();
        const groups = groupTurns([
            { id: 'c', sessionId: 't1', timestamp: day2, content: 'later' },
            { id: 'a', sessionId: 't1', timestamp: day1, content: 'first' },
            { id: 'b', sessionId: 't2', timestamp: day1 + 1, content: 'other thread' },
            { id: 'd', sessionId: 't1', timestamp: day1 + 2, content: 'same day' },
        ], 2);
        expect(groups.map(g => [g.sessionId, g.day, g.rows.map(r => r.id)])).toEqual([
            ['t1', '2026-07-01', ['a', 'd']],
            ['t2', '2026-07-01', ['b']],
        ]);
    });
});
