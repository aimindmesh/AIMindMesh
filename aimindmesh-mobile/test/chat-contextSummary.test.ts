import { describe, expect, it, vi } from 'vitest';

import { applyContextSummary, getContextSummary, saveContextSummary } from '../src/services/llm/contextSummaryStore';
import { summarizeForModel } from '../src/services/llm/contextSummarization';
import type { Message } from '../src/types';

const msg = (id: string, role: Message['role'], text: string): Message => ({ id, role, text, timestamp: new Date(0) });
const chat = Array.from({ length: 12 }, (_, i) => msg(`m${i}`, i % 2 ? 'model' : 'user', `message ${i}`));

describe('context summary (model history only)', () => {
  it('replaces only the covered messages, and only for the model', () => {
    saveContextSummary({ threadId: 't1', summary: 'S', coversUpToId: 'm5', createdAt: 1 });
    const model = applyContextSummary(chat, 't1');
    expect(model.map(m => m.id)).toEqual(['summary-t1', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11']);
    expect(model[0]).toMatchObject({ role: 'system', hidden: true, isSummary: true });
    expect(chat).toHaveLength(12); // the conversation itself is untouched
  });

  it('does not apply to other threads or when the covered messages are gone', () => {
    saveContextSummary({ threadId: 't1', summary: 'S', coversUpToId: 'm5', createdAt: 1 });
    expect(applyContextSummary(chat, 't2')).toBe(chat);
    expect(applyContextSummary(chat.slice(6), 't1')).toEqual(chat.slice(6));
    expect(applyContextSummary(chat, null)).toBe(chat);
  });

  it('summarizes the older part and folds an earlier summary into the new one', async () => {
    saveContextSummary({ threadId: 't1', summary: 'Earlier facts', coversUpToId: 'm3', createdAt: 1 });
    const generate = vi.fn(async (_prompt: string) => 'They planned a trip to Rome.');
    const result = await summarizeForModel(applyContextSummary(chat, 't1'), 0.5, generate);

    expect(result).toMatchObject({ summary: 'They planned a trip to Rome.' });
    expect(chat.map(m => m.id)).toContain(result!.coversUpToId);
    const prompt = generate.mock.calls[0][0] as string;
    expect(prompt).toContain('Earlier summary: Earlier facts');
    expect(prompt).not.toContain('message 0'); // already covered by the earlier summary
  });

  it('keeps the newest summaries only', () => {
    for (let i = 0; i < 55; i++) saveContextSummary({ threadId: `t${i}`, summary: 's', coversUpToId: 'm1', createdAt: i });
    expect(getContextSummary('t0')).toBeNull();
    expect(getContextSummary('t54')).not.toBeNull();
  });
});
