import { describe, expect, it } from 'vitest';
import { createThread, loadThread, loadThreads, saveThread, saveThreadMessages } from '../src/services/llm/threadManager';
import type { Message } from '../src/types';

const msg = (id: string, role: 'user' | 'model', text: string): Message =>
  ({ id, role, text, timestamp: new Date() } as Message);

describe('conversation threads', () => {
  it('stores a new conversation with its first message (thread created on save)', () => {
    const thread = createThread([]); // "New Chat": nothing stored yet
    expect(loadThread(thread.id)).toBeNull();

    expect(saveThreadMessages(thread.id, [msg('1', 'user', 'Plan my trip to Rome')])).toBe(true);

    const stored = loadThread(thread.id);
    expect(stored?.messages).toHaveLength(1);
    expect(stored?.title).toBe('Plan my trip to Rome');
    expect(loadThreads()).toHaveLength(1);
  });

  it('does not create empty threads', () => {
    expect(saveThreadMessages('123', [])).toBe(true);
    expect(loadThreads()).toHaveLength(0);
  });

  it('updates an existing thread and keeps a title the user already has', () => {
    const thread = { ...createThread([msg('1', 'user', 'First')]), title: 'Renamed' };
    saveThread(thread);
    saveThreadMessages(thread.id, [msg('1', 'user', 'First'), msg('2', 'model', 'Answer')]);

    const stored = loadThread(thread.id);
    expect(stored?.messages.map(m => m.id)).toEqual(['1', '2']);
    expect(stored?.title).toBe('Renamed');
    expect(loadThreads()).toHaveLength(1);
  });

  it('titles a thread created empty at first launch once it has messages', () => {
    const thread = createThread([]);
    saveThread(thread);
    saveThreadMessages(thread.id, [msg('1', 'user', 'Hello there')]);
    expect(loadThread(thread.id)?.title).toBe('Hello there');
  });
});
