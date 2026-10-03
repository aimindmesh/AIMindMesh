import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Task logic with an in-memory stand-in for the calendar database: just the statements the
 * task services issue (rows keyed by id, columns as stored).
 */
const rows = new Map<string, Record<string, any>>();
const norm = (sql: string) => sql.replace(/\s+/g, ' ').trim();
const byDueDesc = (a: any, b: any) => b.due_date - a.due_date;

const fakeDb = {
  async query(sql: string, params: any[] = []) {
    const q = norm(sql);
    const all = [...rows.values()];
    if (q.startsWith('SELECT MAX(task_order)')) {
      const orders = all.filter(r => r.status === params[0]).map(r => r.task_order);
      return { values: [{ max_order: orders.length ? Math.max(...orders) : null }] };
    }
    if (q.includes('WHERE id = ? OR recurrence_parent_id = ?')) {
      return { values: all.filter(r => r.id === params[0] || r.recurrence_parent_id === params[1]).sort(byDueDesc).slice(0, 1) };
    }
    if (q.includes('recurrence_rule IS NOT NULL')) {
      return { values: all.filter(r => r.recurrence_rule && !r.recurrence_parent_id && !r.parent_task_id) };
    }
    if (q.includes('WHERE status = ? AND parent_task_id IS NULL')) {
      return { values: all.filter(r => r.status === params[0] && !r.parent_task_id) };
    }
    if (q === 'SELECT * FROM calendar_tasks WHERE id = ?') {
      return { values: rows.has(params[0]) ? [rows.get(params[0])] : [] };
    }
    return { values: [] };
  },
  async run(sql: string, params: any[] = []) {
    const q = norm(sql);
    const insert = q.match(/^INSERT INTO calendar_tasks \(([^)]+)\)/);
    if (insert) {
      const cols = insert[1].split(',').map(c => c.trim());
      const row: Record<string, any> = {};
      cols.forEach((c, i) => { row[c] = params[i]; });
      rows.set(row.id, row);
      return;
    }
    const update = q.match(/^UPDATE calendar_tasks SET (.+) WHERE id = \?$/);
    if (update) {
      const row = rows.get(params[params.length - 1]);
      update[1].split(',').map(s => s.trim().replace(' = ?', '')).forEach((c, i) => { if (row) row[c] = params[i]; });
      return;
    }
    if (q === 'DELETE FROM calendar_tasks WHERE id = ?') rows.delete(params[0]);
    if (q === 'DELETE FROM calendar_tasks WHERE parent_task_id = ?') {
      for (const [id, r] of rows) if (r.parent_task_id === params[0]) rows.delete(id);
    }
  },
};

const mocks = vi.hoisted(() => ({
  schedule: vi.fn(async () => ({})),
  cancel: vi.fn(async () => {}),
  deleteAiTask: vi.fn(async () => {}),
  updateScreen: vi.fn(async () => {}),
}));

vi.mock('../src/services/calendar/calendarDatabase', () => ({ getCalendarDatabase: async () => fakeDb }));
vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: { schedule: mocks.schedule, cancel: mocks.cancel, createChannel: vi.fn(), requestPermissions: vi.fn() },
}));
vi.mock('../src/services/calendar/AiTaskService', () => ({ AiTaskService: { deleteTask: mocks.deleteAiTask } }));
vi.mock('android-auto-capacitor', () => ({ AndroidAuto: { updateScreen: mocks.updateScreen } }));

import { createTask, updateTask, deleteTask, getTaskById } from '../src/services/calendar/tasks/taskOperations';
import { buildAutoKanbanPayload } from '../src/services/calendar/tasks/taskSync';
import { nextOccurrenceDue, needsNextOccurrence, generateUpcomingOccurrences } from '../src/services/calendar/taskRecurrence';
import { getReminderTime } from '../src/services/calendar/taskNotifications';
import { matchesTaskFilters, moveTaskInBoard } from '../src/components/agenda/tasks/kanbanMove';
import type { CalendarTask, KanbanBoard } from '../src/types/calendar';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const task = (over: Partial<CalendarTask> = {}): CalendarTask => ({
  id: 't1', title: 'Task', description: '', status: 'todo', priority: 'medium', createdAt: 0, dueDate: 0,
  tags: [], order: 0, pomodoroCount: 0, assignee: 'user', ...over,
});

beforeEach(() => {
  rows.clear();
  mocks.schedule.mockClear();
  mocks.cancel.mockClear();
  mocks.deleteAiTask.mockClear();
});

describe('task reminders', () => {
  it('fires one hour before the due date, never for done, AI or past tasks', () => {
    const now = 1_000_000;
    expect(getReminderTime(task({ dueDate: now + 3 * HOUR }), now)).toBe(now + 2 * HOUR);
    expect(getReminderTime(task({ dueDate: now + 3 * HOUR, status: 'done' }), now)).toBeNull();
    expect(getReminderTime(task({ dueDate: now + 3 * HOUR, assignee: 'ai' }), now)).toBeNull();
    expect(getReminderTime(task({ dueDate: now + 3 * HOUR, parentTaskId: 'p' }), now)).toBeNull();
    expect(getReminderTime(task({ dueDate: now + HOUR / 2 }), now)).toBeNull();
  });

  it('is scheduled on creation from any caller and only cancelled when the task is completed', async () => {
    const created = await createTask({ title: 'Report', description: '', status: 'todo', priority: 'high', dueDate: Date.now() + 5 * HOUR, tags: [] });
    await flush();
    expect(mocks.schedule).toHaveBeenCalledTimes(1);
    expect((mocks.schedule.mock.calls[0] as any)[0].notifications[0].channelId).toBe('task-reminders');

    await updateTask(created.id, { status: 'done' });
    expect(mocks.cancel).toHaveBeenCalled();
    expect(mocks.schedule).toHaveBeenCalledTimes(1);
  });

  it('deleting an AI task also removes it from the server, unassigning it too', async () => {
    const ai = await createTask({ title: 'Digest', description: '', status: 'todo', priority: 'low', dueDate: Date.now() + DAY, tags: [], assignee: 'ai' });
    await updateTask(ai.id, { assignee: 'user' });
    await flush();
    expect(mocks.deleteAiTask).toHaveBeenCalledWith(ai.id);

    mocks.deleteAiTask.mockClear();
    await updateTask(ai.id, { assignee: 'ai' });
    await deleteTask(ai.id);
    await flush();
    expect(mocks.deleteAiTask).toHaveBeenCalledWith(ai.id);
    expect(await getTaskById(ai.id)).toBeNull();
  });
});

describe('task recurrence', () => {
  const daily = { type: 'daily' as const, interval: 1, endDate: null };

  it('skips missed steps instead of piling up overdue copies', () => {
    const now = Date.UTC(2026, 9, 10, 12);
    const due = Date.UTC(2026, 9, 1, 12);
    expect(nextOccurrenceDue(due, daily, now)).toBe(Date.UTC(2026, 9, 11, 12));
    expect(nextOccurrenceDue(now + DAY, daily, now)).toBe(now + 2 * DAY);
  });

  it('stops at the end date and never loops on a zero interval', () => {
    const now = 0;
    expect(nextOccurrenceDue(DAY, { type: 'daily', interval: 1, endDate: DAY + HOUR }, now)).toBeNull();
    expect(nextOccurrenceDue(DAY, { type: 'weekly', interval: 0 }, now)).toBe(8 * DAY);
  });

  it('needs a new occurrence only once the latest is done or past due', () => {
    expect(needsNextOccurrence({ status: 'done', dueDate: 10 }, 5)).toBe(true);
    expect(needsNextOccurrence({ status: 'todo', dueDate: 4 }, 5)).toBe(true);
    expect(needsNextOccurrence({ status: 'todo', dueDate: 10 }, 5)).toBe(false);
  });

  it('completing a recurring task creates one next occurrence linked to the root, and only once', async () => {
    const root = await createTask({ title: 'Gym', description: '', status: 'todo', priority: 'medium', dueDate: Date.now() + HOUR, tags: [], recurrenceRule: daily });
    await updateTask(root.id, { status: 'done' });

    const occurrences = [...rows.values()].filter(r => r.recurrence_parent_id === root.id);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].due_date).toBe(root.dueDate + DAY);

    // The board load does not add more while that occurrence is open
    await generateUpcomingOccurrences();
    await generateUpcomingOccurrences();
    expect([...rows.values()].filter(r => r.recurrence_parent_id === root.id)).toHaveLength(1);

    // Completing the occurrence continues the same series (root id, not the occurrence id)
    await updateTask(occurrences[0].id, { status: 'done' });
    const series = [...rows.values()].filter(r => r.recurrence_parent_id === root.id);
    expect(series).toHaveLength(2);
    expect([...rows.values()].some(r => r.recurrence_parent_id === occurrences[0].id)).toBe(false);
  });
});

describe('kanban board', () => {
  const board = (): KanbanBoard => ({
    backlog: [],
    todo: [task({ id: 'A', priority: 'low' }), task({ id: 'B', priority: 'high' }), task({ id: 'C', priority: 'high' })],
    'in-progress': [],
    review: [],
    done: [task({ id: 'D', status: 'done', priority: 'low' }), task({ id: 'E', status: 'done', priority: 'high' })],
  });
  const highOnly = (t: CalendarTask) => matchesTaskFilters(t, { priority: ['high'] }, new Set());

  it('moves the dragged task, not the one at the same unfiltered index', () => {
    // Filtered view: todo [B, C], done [E]. B dropped at the top of Done.
    const moved = moveTaskInBoard(board(), 'B', 'done', 0, highOnly)!;
    expect(moved.board.todo.map(t => t.id)).toEqual(['A', 'C']);
    expect(moved.board.done.map(t => t.id)).toEqual(['D', 'B', 'E']);
    expect(moved.board.done[1].status).toBe('done');
    expect(moved.order).toBe(1);
  });

  it('places a drop after the last visible task and reorders within a column', () => {
    expect(moveTaskInBoard(board(), 'B', 'done', 1, highOnly)!.board.done.map(t => t.id)).toEqual(['D', 'E', 'B']);
    expect(moveTaskInBoard(board(), 'C', 'todo', 0, highOnly)!.board.todo.map(t => t.id)).toEqual(['A', 'C', 'B']);
    expect(moveTaskInBoard(board(), 'missing', 'todo', 0, highOnly)).toBeNull();
  });

  it('filters "has subtasks" by the ids that have some', () => {
    expect(matchesTaskFilters(task({ id: 'A' }), { hasSubtasks: true }, new Set(['A']))).toBe(true);
    expect(matchesTaskFilters(task({ id: 'B' }), { hasSubtasks: true }, new Set(['A']))).toBe(false);
  });

  it('sends Android Auto the normalized board AutoUtils.java parses', () => {
    const payload = JSON.parse(buildAutoKanbanPayload(board()));
    expect(payload.columnOrder).toEqual(['backlog', 'todo', 'in-progress', 'review', 'done']);
    expect(payload.columns.todo).toEqual({ id: 'todo', title: 'To Do', taskIds: ['A', 'B', 'C'] });
    expect(payload.tasks.E).toEqual({ id: 'E', content: 'Task' });
  });
});
