import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLineDecoder, parseSseData } from '../src/services/streamLines';
import { sendReply, FeedStreamChunk } from '../src/services/feedService';

const enc = new TextEncoder();
const settings = { enabled: true, serverUrl: 'http://srv/', apiKey: 'K' } as any;

function streamResponse(parts: (string | Uint8Array)[], contentType: string) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      parts.forEach(p => controller.enqueue(typeof p === 'string' ? enc.encode(p) : p));
      controller.close();
    }
  });
  return new Response(body, { status: 200, headers: { 'content-type': contentType } });
}

describe('line decoder', () => {
  it('keeps a line split across chunks and a split multi-byte character', () => {
    const lines = createLineDecoder();
    const bytes = enc.encode('data: {"delta":"perché"}\n');
    const cut = bytes.indexOf(0xc3) + 1; // inside "é"
    expect(lines.push(bytes.slice(0, 10))).toEqual([]);
    expect(lines.push(bytes.slice(10, cut))).toEqual([]);
    expect(lines.push(bytes.slice(cut))).toEqual(['data: {"delta":"perché"}']);
    expect(lines.end()).toEqual([]);
  });

  it('returns a last line without newline at the end', () => {
    const lines = createLineDecoder();
    expect(lines.push(enc.encode('{"a":1}\n{"b"'))).toEqual(['{"a":1}']);
    expect(lines.push(enc.encode(':2}'))).toEqual([]);
    expect(lines.end()).toEqual(['{"b":2}']);
  });

  it('extracts SSE data payloads', () => {
    expect(parseSseData('data: {"delta":"x"}\r')).toBe('{"delta":"x"}');
    expect(parseSseData('data: [DONE]')).toBe('[DONE]');
    expect(parseSseData(': keep-alive')).toBeNull();
  });
});

describe('feed replies', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('shows the single JSON answer of an insight without a debate', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ reply: { role: 'user' }, assistantReply: { role: 'assistant', content: 'Here is why' } }),
      { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } }
    )));
    const chunks: FeedStreamChunk[] = [];
    await sendReply(settings, 'i1', 'why?', c => chunks.push(c));
    expect(chunks).toEqual([{ token: 'Here is why', done: false, role: 'assistant' }, { done: true }]);
  });

  it('streams debate messages split across chunks', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => streamResponse([
      '{"type":"user_reply","reply":{}}\n{"type":"agent_re',
      'ply","message":{"author":"CRITIC","content":"No"}}\n',
      '{"type":"agent_reply","message":{"author":"ADVOCATE","content":"Yes"}}'
    ], 'application/x-ndjson')));
    const chunks: FeedStreamChunk[] = [];
    await sendReply(settings, 'i1', 'debate', c => chunks.push(c));
    expect(chunks.filter(c => c.token).map(c => [c.role, c.token])).toEqual([['CRITIC', 'No'], ['ADVOCATE', 'Yes']]);
    expect(chunks[chunks.length - 1]).toEqual({ done: true });
  });

  it('reports a server error line instead of swallowing it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => streamResponse(['{"type":"error","message":"LLM down"}\n'], 'application/x-ndjson')));
    await expect(sendReply(settings, 'i1', 'x', () => { })).rejects.toThrow('LLM down');
  });
});
