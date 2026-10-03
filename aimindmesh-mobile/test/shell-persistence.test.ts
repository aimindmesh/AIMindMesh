import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Desktop file system with a slow, async write (like Tauri IPC)
const disk = vi.hoisted(() => ({ files: new Map<string, string>(), writes: 0 }));

vi.mock('../src/utils/platform', () => ({ isDesktop: () => true }));
vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('../src/utils/fileSystemAdapter', () => ({
  Directory: { Data: 'DATA' },
  Encoding: { UTF8: 'utf8' },
  FileSystemAdapter: {
    stat: async ({ path }: { path: string }) => {
      if (!disk.files.has(path)) throw new Error('missing');
      return { size: disk.files.get(path)!.length };
    },
    readFile: async ({ path }: { path: string }) => ({ data: disk.files.get(path) }),
    writeFile: async ({ path, data }: { path: string; data: string }) => {
      await new Promise(r => setTimeout(r, 5));
      disk.writes++;
      disk.files.set(path, data);
    },
  },
}));

import { PersistenceService } from '../src/services/config/persistenceService';

const saved = () => JSON.parse(disk.files.get('app-settings.json') || '{}');

describe('desktop settings file', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    disk.files.clear();
    disk.writes = 0;
    disk.files.set('app-settings.json', JSON.stringify({ theme: 'dark', 'llm-config': { provider: 'gemini' } }));
    PersistenceService.resetForTests();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('keeps every key of a settings save made of many concurrent changes', async () => {
    await Promise.all([
      PersistenceService.saveItem('llm-config', { provider: 'claude' }),
      PersistenceService.saveItem('response-style', 'concise'),
      PersistenceService.saveItem('enable-dnd', true),
      PersistenceService.removeItem('theme'),
    ]);
    await vi.advanceTimersByTimeAsync(1000);

    expect(saved()).toEqual({ 'llm-config': { provider: 'claude' }, 'response-style': 'concise', 'enable-dnd': true });
    expect(disk.writes).toBe(1); // written together
  });

  it('a burst of changes to one key ends with the newest value', async () => {
    for (let i = 0; i < 20; i++) await PersistenceService.saveItem('chat-history', [i]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(saved()['chat-history']).toEqual([19]);
    expect(saved().theme).toBe('dark');
  });
});
