import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addListener: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock('@capacitor/device', () => ({ Device: { getId: async () => ({ identifier: 'dev-1' }) } }));
vi.mock('@capacitor/app', () => ({
  App: { addListener: (...args: any[]) => { mocks.addListener(...args); return Promise.resolve({ remove: mocks.removeListener }); } },
}));
vi.mock('../src/services/llm/llmService', () => ({ generateTextResponseStream: vi.fn() }));
vi.mock('../src/services/llm/nativeLLM', () => ({ saveNativeKvCache: vi.fn() }));
vi.mock('../src/services/llm/providers/liteRT/plugin', () => ({ saveLiteRTKvCache: vi.fn() }));
vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));

class FakeSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: FakeSocket[] = [];
  readyState = FakeSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: any = null;
  onerror: any = null;
  closed = false;
  constructor(public url: string) { FakeSocket.instances.push(this); }
  open() { this.readyState = FakeSocket.OPEN; this.onopen?.(); }
  close() { this.closed = true; this.readyState = 3; }
  /** The server or network dropped the link */
  drop() { this.readyState = 3; this.onclose?.(); }
  send() { }
}

import { nodeWorker, RECONNECT_MIN_MS } from '../src/services/worker/NodeWorker';

const settings = (apiKey = 'K') => ({ enabled: true, serverUrl: 'http://srv', apiKey, deviceName: 'Phone' } as any);
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('NodeWorker lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
    FakeSocket.instances = [];
    mocks.addListener.mockClear();
    mocks.removeListener.mockClear();
  });
  afterEach(() => {
    nodeWorker.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('init is idempotent: one socket, one listener, one survival timer', async () => {
    nodeWorker.init(settings());
    nodeWorker.init(settings()); // e.g. called again after a model change
    await flush();
    FakeSocket.instances[0]?.open();
    nodeWorker.init(settings());
    await flush();

    expect(FakeSocket.instances).toHaveLength(1);
    expect(mocks.addListener).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1); // survival log only
    expect(FakeSocket.instances[0].url).toContain('token=K');
  });

  it('stop removes the listener and the timers and does not reconnect', async () => {
    nodeWorker.init(settings());
    await flush();
    const socket = FakeSocket.instances[0];
    socket.open();
    nodeWorker.stop();
    await flush();

    expect(socket.closed).toBe(true);
    expect(mocks.removeListener).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('reconnects with a growing delay, reset once connected', async () => {
    nodeWorker.init(settings());
    await flush();
    FakeSocket.instances[0].drop();

    await vi.advanceTimersByTimeAsync(RECONNECT_MIN_MS);
    expect(FakeSocket.instances).toHaveLength(2);
    FakeSocket.instances[1].drop();

    await vi.advanceTimersByTimeAsync(RECONNECT_MIN_MS); // next delay is doubled
    expect(FakeSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(RECONNECT_MIN_MS);
    expect(FakeSocket.instances).toHaveLength(3);

    FakeSocket.instances[2].open();
    FakeSocket.instances[2].drop();
    await vi.advanceTimersByTimeAsync(RECONNECT_MIN_MS); // back to the minimum
    expect(FakeSocket.instances).toHaveLength(4);
  });

  it('reopens the socket when the API key changes', async () => {
    nodeWorker.init(settings('OLD'));
    await flush();
    FakeSocket.instances[0].open();
    nodeWorker.init(settings('NEW'));
    await flush();

    expect(FakeSocket.instances).toHaveLength(2);
    expect(FakeSocket.instances[0].closed).toBe(true);
    expect(FakeSocket.instances[1].url).toContain('token=NEW');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeSocket.instances).toHaveLength(2); // the old socket's close does not reconnect
  });
});
