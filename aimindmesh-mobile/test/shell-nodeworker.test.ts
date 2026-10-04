import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addListener: vi.fn(),
  removeListener: vi.fn(),
  stream: vi.fn(),
}));

vi.mock('@capacitor/device', () => ({ Device: { getId: async () => ({ identifier: 'dev-1' }) } }));
vi.mock('@capacitor/app', () => ({
  App: { addListener: (...args: any[]) => { mocks.addListener(...args); return Promise.resolve({ remove: mocks.removeListener }); } },
}));
vi.mock('../src/services/llm/llmService', () => ({ generateTextResponseStream: mocks.stream }));
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
  sent: any[] = [];
  send(data: string) { this.sent.push(JSON.parse(data)); }
  /** A message from the server */
  receive(message: unknown) { return this.onmessage?.({ data: JSON.stringify(message) }); }
}

import { nodeWorker, RECONNECT_MIN_MS } from '../src/services/worker/NodeWorker';
import { beginChatActivity, resetChatActivity } from '../src/services/llm/background/chatActivity';
import { yieldToChat } from '../src/services/llm/background/llmArbiter';
import { isInternalTask } from '../src/services/llm/background/taskFlags';

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

  it('a server push wakes the worker even after the heartbeat stopped it', async () => {
    nodeWorker.init({ ...settings(), participateAsWorker: true });
    await flush();
    nodeWorker.stop();
    nodeWorker.wake();
    await flush();
    expect(FakeSocket.instances).toHaveLength(2);

    nodeWorker.init({ ...settings(), participateAsWorker: false });
    await flush();
    nodeWorker.stop();
    const sockets = FakeSocket.instances.length;
    nodeWorker.wake(); // the user left the mesh: no reconnect
    await flush();
    expect(FakeSocket.instances).toHaveLength(sockets);
  });
});

describe('NodeWorker tasks', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
    FakeSocket.instances = [];
    resetChatActivity();
    mocks.stream.mockReset();
  });
  afterEach(() => {
    nodeWorker.stop();
    vi.unstubAllGlobals();
  });

  async function openWorker() {
    nodeWorker.init(settings(), { provider: 'native-gguf' } as any, { name: 'Ada', description: '', systemPrompt: 'Be brief.', traits: ['x'] });
    await new Promise(r => setTimeout(r, 0));
    const socket = FakeSocket.instances[FakeSocket.instances.length - 1];
    socket.open();
    return socket;
  }

  it('answers without the owner\'s memories, and refuses while the owner chats', async () => {
    mocks.stream.mockImplementation(async function* () { yield { type: 'text', content: 'Hi' }; });
    const socket = await openWorker();
    await socket.receive({ type: 'task', id: 't1', payload: { prompt: 'Hello' } });
    expect(socket.sent[socket.sent.length - 1]).toMatchObject({ type: 'result', id: 't1', reply: 'Hi' });
    const [, persona, config] = mocks.stream.mock.calls[0];
    expect(isInternalTask(config)).toBe(true);
    expect(persona).toMatchObject({ systemPrompt: 'Be brief.', traits: [] });

    const end = beginChatActivity();
    await socket.receive({ type: 'task', id: 't2', payload: { prompt: 'Hello' } });
    expect(socket.sent[socket.sent.length - 1]).toMatchObject({ type: 'result', id: 't2', error: expect.stringMatching(/^WORKER_BUSY/) });
    end();
  });

  it('gives the task up with an error when the owner starts chatting', async () => {
    mocks.stream.mockImplementation(async function* (_h: any, _p: any, _c: any, _k: any, signal: AbortSignal) {
      yield { type: 'text', content: 'par' };
      void yieldToChat(); // the owner sends a message
      if (signal.aborted) return;
      yield { type: 'text', content: 'tial' };
    });
    const socket = await openWorker();
    await socket.receive({ type: 'task', id: 't3', payload: { prompt: 'Hello' } });
    expect(socket.sent[socket.sent.length - 1]).toMatchObject({ type: 'result', id: 't3', error: expect.stringMatching(/^WORKER_BUSY/) });
  });
});
