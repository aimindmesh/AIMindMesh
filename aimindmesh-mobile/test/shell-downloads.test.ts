import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Native downloader: statuses per URL, as LlamaCpp.getDownloadProgress reports them
const plugin = vi.hoisted(() => ({
  statuses: new Map<string, any>(),
  files: new Map<string, number>(),
  deleted: [] as string[],
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'android', isNativePlatform: () => true },
  registerPlugin: () => ({
    downloadModel: async ({ filename }: { filename: string }) => ({ localPath: `/data/${filename}` }),
    // Unknown URLs get the native placeholder, without byte counters
    getDownloadProgress: async ({ url }: { url: string }) =>
      plugin.statuses.get(url) ?? { progress: 0, completed: false, failed: false },
    cancelDownload: async () => ({ cancelled: true }),
  }),
}));

vi.mock('../src/utils/fileSystemAdapter', () => ({
  Directory: { Data: 'DATA' },
  Encoding: { UTF8: 'utf8' },
  FileSystemAdapter: {
    stat: async ({ path }: { path: string }) => {
      if (!plugin.files.has(path)) throw new Error('not found');
      return { size: plugin.files.get(path) };
    },
    deleteFile: async ({ path }: { path: string }) => { plugin.deleted.push(path); plugin.files.delete(path); },
  },
}));

import { checkDownloadedSize, downloadModel, getDownloadStatus, isTrackedStatus, normalizeDownloadUrl, trackDownload } from '../src/services/model/modelDownloader';

const URL = 'https://huggingface.co/x/y/resolve/main/m.gguf';
const status = (bytesDownloaded: number, totalBytes: number, extra: object = {}) =>
  ({ bytesDownloaded, totalBytes, completed: false, failed: false, cancelled: false, error: null, ...extra });

describe('download verification', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    plugin.statuses.clear();
    plugin.files.clear();
    plugin.deleted.length = 0;
  });
  afterEach(() => { vi.useRealTimers(); });

  it('rejects error pages and incomplete files', () => {
    expect(checkDownloadedSize(500, 0)).toMatch(/too small/);
    expect(checkDownloadedSize(1_000_000, 2_000_000)).toMatch(/Incomplete/);
    expect(checkDownloadedSize(2_000_000, 2_000_000)).toBeNull();
    expect(checkDownloadedSize(2_000_000, 0)).toBeNull(); // size unknown (no Content-Length)
  });

  it('tells a real download status from the placeholder for unknown URLs', () => {
    expect(isTrackedStatus(status(0, 100))).toBe(true);
    expect(isTrackedStatus({ progress: 0, completed: false, failed: false })).toBe(false);
    expect(normalizeDownloadUrl('https://huggingface.co/a/blob/main/f.gguf')).toBe('https://huggingface.co/a/resolve/main/f.gguf');
  });

  it('waits for the end of the download and checks the file size', async () => {
    plugin.statuses.set(URL, status(10, 4096));
    const progress: number[] = [];
    const done = downloadModel(URL, 'm.gguf', p => progress.push(Math.round(p.percentage)));

    await vi.advanceTimersByTimeAsync(600);
    plugin.statuses.set(URL, status(4096, 4096, { completed: true }));
    plugin.files.set('m.gguf', 4096);
    await vi.advanceTimersByTimeAsync(600);

    await expect(done).resolves.toBe('/data/m.gguf');
    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(100);
  });

  it('deletes and rejects a completed file that is shorter than announced', async () => {
    plugin.statuses.set(URL, status(4096, 8192, { completed: true }));
    plugin.files.set('m.gguf', 4096);
    const done = trackDownload(URL, 'm.gguf');
    const assertion = expect(done).rejects.toThrow(/Incomplete/);
    await vi.advanceTimersByTimeAsync(600);
    await assertion;
    expect(plugin.deleted).toEqual(['m.gguf']);
  });

  it('stops waiting when the plugin no longer knows the download (cancelled)', async () => {
    const done = trackDownload(URL, 'm.gguf');
    const assertion = expect(done).rejects.toThrow(/cancelled/);
    await vi.advanceTimersByTimeAsync(2500);
    await assertion;
  });

  it('reports a running download to a reopened screen, not a finished or unknown one', async () => {
    expect(await getDownloadStatus(URL)).toBeNull();
    plugin.statuses.set(URL, status(50, 100));
    expect(await getDownloadStatus(URL)).toMatchObject({ percentage: 50, completed: false, cancelled: false });
  });
});
