import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import Fastify from 'fastify';

// Scripted SDK streams: each call takes the next step (events, then the final message, or an error)
const script: Array<{ events?: any[]; message?: any; error?: unknown }> = [];
const calls: any[] = [];
vi.mock('../src/services/inference/claude/claudeClient', () => ({
  claudeKeyFingerprint: () => 'sk-ant-…test',
  claudeClient: () => ({
    beta: {
      messages: {
        stream: (params: any) => {
          calls.push(params);
          const step = script.shift() ?? { events: [], message: message('default') };
          return {
            [Symbol.asyncIterator]() {
              const events = [...(step.events ?? [])];
              return {
                async next() {
                  if (step.error) throw step.error;
                  return events.length ? { done: false, value: events.shift() } : { done: true, value: undefined };
                },
              };
            },
            finalMessage: async () => step.message,
          };
        },
      },
    },
  }),
}));

import db from '../src/db/sqlite';
import { config } from '../src/config';
import { agentProxyRoutes } from '../src/api/routes/agentProxy';
import { toAnthropicRequest, TranslationError } from '../src/services/inference/claude/agentBridge/openaiToAnthropic';
import { OpenAiChunkWriter } from '../src/services/inference/claude/agentBridge/streamToOpenai';
import { agentKeyAllowed, claudeAgentRoute } from '../src/services/inference/claude/agentBridge/agentClaudeGate';
import { clearThinkingStore, rememberThinking } from '../src/services/inference/claude/agentBridge/thinkingStore';
import { resetAgentBridge } from '../src/services/inference/claude/agentBridge/serveWithClaude';
import { ClaudeCreditState } from '../src/services/inference/claude/ClaudeCreditState';
import { ClaudeUsage } from '../src/services/inference/claude/ClaudeUsage';
import { updateBuildSettings } from '../src/services/organization/venture/BuildSettings';

const AGENT_KEY = 'freellm-agent-key-123';

function message(text: string, extra: Record<string, unknown> = {}) {
  return {
    id: 'msg_1', model: 'claude-sonnet-5-5', stop_reason: 'end_turn',
    content: [{ type: 'text', text }],
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
    ...extra,
  };
}

const apiError = (status: number, type: string, msg: string) =>
  Anthropic.APIError.generate(status, { type: 'error', error: { type, message: msg } }, undefined, new Headers());

let freeLlmApiCalls: any[] = [];
const originalAdapter = axios.defaults.adapter;

beforeEach(() => {
  script.length = 0;
  calls.length = 0;
  freeLlmApiCalls = [];
  (config as any).claude = { apiKey: 'sk-ant-test-key-0000' };
  (config as any).freellmapi = { enabled: true, baseUrl: 'http://freellm.test', apiKey: AGENT_KEY, timeoutMs: 1000, model: 'auto' };
  axios.defaults.adapter = async (req: any) => {
    freeLlmApiCalls.push({ url: req.url, data: JSON.parse(req.data) });
    return { data: { id: 'free', choices: [{ message: { role: 'assistant', content: 'from freellmapi' } }] }, status: 200, statusText: 'OK', headers: {}, config: req };
  };
  db.prepare('DELETE FROM claude_usage').run();
  ClaudeUsage.resetCache();
  ClaudeCreditState.reset();
  clearThinkingStore();
  resetAgentBridge();
});

afterEach(() => {
  axios.defaults.adapter = originalAdapter;
  (config as any).claude = { apiKey: '' };
  (config as any).freellmapi = { enabled: false, baseUrl: 'http://127.0.0.1:1', apiKey: '', timeoutMs: 1000, model: 'test' };
  ClaudeCreditState.reset();
});

describe('OpenAI → Claude request translation', () => {
  const opts = { model: 'claude-sonnet-5-5', effort: 'medium' as const, defaultMaxTokens: 32000 };

  it('hoists system messages, maps tools and tool turns, drops sampling parameters', () => {
    rememberThinking([{ type: 'thinking', thinking: '', signature: 'sig' } as any, { type: 'tool_use', id: 'call_1' }]);
    const params = toAnthropicRequest({
      model: 'gemini-3.1-pro', temperature: 0.2, top_p: 0.9, seed: 1, max_tokens: 100, stop: ['END'],
      tool_choice: 'required', parallel_tool_calls: false,
      tools: [{ type: 'function', function: { name: 'read_file', description: 'Read', parameters: { properties: { path: { type: 'string' } } } } }],
      messages: [
        { role: 'system', content: 'You are an agent.' },
        { role: 'user', content: [{ type: 'text', text: 'Look' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] },
        { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } }] },
        { role: 'tool', tool_call_id: 'call_1', content: 'file body' },
      ],
    }, opts);

    expect(params.system).toEqual([{ type: 'text', text: 'You are an agent.', cache_control: { type: 'ephemeral' } }]);
    expect(params.cache_control).toEqual({ type: 'ephemeral' });
    expect(params.messages[0]).toEqual({ role: 'user', content: [
      { type: 'text', text: 'Look' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    ] });
    expect(params.messages[1]).toEqual({ role: 'assistant', content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'tool_use', id: 'call_1', name: 'read_file', input: { path: 'a.ts' } },
    ] });
    expect(params.messages[2]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'file body' }] });
    expect(params.tools).toEqual([{ name: 'read_file', description: 'Read', input_schema: { type: 'object', properties: { path: { type: 'string' } } } }]);
    expect(params.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true });
    expect(params.max_tokens).toBe(4096); // raised: thinking needs room
    expect(params.stop_sequences).toEqual(['END']);
    expect(params.output_config).toEqual({ effort: 'medium' });
    expect((params as any).temperature).toBeUndefined();
    expect((params as any).top_p).toBeUndefined();
  });

  it('groups consecutive tool results in one user turn and maps json_schema output', () => {
    const params = toAnthropicRequest({
      response_format: { type: 'json_schema', json_schema: { schema: { type: 'object' } } },
      messages: [
        { role: 'user', content: 'go' },
        { role: 'assistant', content: 'Two calls', tool_calls: [
          { id: 'a', function: { name: 'f', arguments: '{}' } }, { id: 'b', function: { name: 'f', arguments: '' } },
        ] },
        { role: 'tool', tool_call_id: 'a', content: 'A' },
        { role: 'tool', tool_call_id: 'b', content: [{ type: 'text', text: 'B' }] },
        { role: 'user', content: 'and then?' },
      ],
    }, opts);
    expect(params.messages).toHaveLength(3);
    expect(params.messages[2].content).toEqual([
      { type: 'tool_result', tool_use_id: 'a', content: 'A' },
      { type: 'tool_result', tool_use_id: 'b', content: 'B' },
      { type: 'text', text: 'and then?' },
    ]);
    expect(params.output_config?.format).toEqual({ type: 'json_schema', schema: { type: 'object' } });
  });

  it('refuses what it cannot express', () => {
    expect(() => toAnthropicRequest({ messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'prefill' }] }, opts)).toThrow(TranslationError);
    expect(() => toAnthropicRequest({ messages: [{ role: 'assistant', content: '', tool_calls: [{ id: 'x', function: { name: 'f', arguments: '{bad' } }] }, { role: 'tool', tool_call_id: 'x', content: '' }] }, opts)).toThrow(TranslationError);
    expect(() => toAnthropicRequest({ n: 2, messages: [{ role: 'user', content: 'x' }] }, opts)).toThrow(TranslationError);
  });
});

describe('Claude stream → OpenAI chunks', () => {
  it('streams text, tool calls with partial arguments, the finish reason and usage', () => {
    const w = new OpenAiChunkWriter('claude-sonnet-5-5', true, 'chatcmpl-1');
    const out = [
      w.write({ type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0 } } } as any),
      w.write({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } } as any),
      w.write({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } } as any),
      w.write({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } } as any),
      w.write({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Reading' } } as any),
      w.write({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'read_file' } } as any),
      w.write({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"pa' } } as any),
      w.write({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: 'th":"a"}' } } as any),
      w.write({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 30 } } as any),
      w.end(),
    ].join('');
    const chunks = out.split('\n\n').filter(Boolean).map(l => l.replace(/^data: /, '')).filter(l => l !== '[DONE]').map(l => JSON.parse(l));
    expect(chunks[0].choices[0].delta).toEqual({ role: 'assistant', content: '' });
    expect(chunks[1].choices[0].delta).toEqual({ content: 'Reading' });
    expect(chunks[2].choices[0].delta.tool_calls[0]).toEqual({ index: 0, id: 'toolu_1', type: 'function', function: { name: 'read_file', arguments: '' } });
    expect(chunks[3].choices[0].delta.tool_calls[0]).toEqual({ index: 0, function: { arguments: '{"pa' } });
    expect(chunks[5].choices[0].finish_reason).toBe('tool_calls');
    expect(chunks[6].usage).toMatchObject({ prompt_tokens: 10, completion_tokens: 30 });
    expect(out.endsWith('data: [DONE]\n\n')).toBe(true);
  });
});

describe('who may use Claude through the proxy', () => {
  it('accepts only the known agent keys', () => {
    expect(agentKeyAllowed(`Bearer ${AGENT_KEY}`)).toBe(true);
    expect(agentKeyAllowed('Bearer someone-else-key')).toBe(false);
    (config as any).claude.agents = { proxyKeys: ['hermes-own-key-456'] };
    expect(agentKeyAllowed('Bearer hermes-own-key-456')).toBe(true);
  });

  it('keeps non-Claude build models, disabled agents and an unavailable Claude on FreeLLMAPI', () => {
    expect(claudeAgentRoute('builder', `Bearer ${AGENT_KEY}`, 'gpt-5')).toBeNull();
    const build = claudeAgentRoute('builder', `Bearer ${AGENT_KEY}`, null);
    expect(build).toMatchObject({ model: 'claude-opus-5-5', effort: 'high', source: 'builder' });
    build!.ticket.release();
    (config as any).claude.agents = { enabled: false };
    expect(claudeAgentRoute('agent', `Bearer ${AGENT_KEY}`, null)).toBeNull();
    (config as any).claude = { apiKey: '' };
    expect(claudeAgentRoute('agent', `Bearer ${AGENT_KEY}`, null)).toBeNull();
  });
});

describe('agent proxy routes', () => {
  async function app() {
    const f = Fastify();
    agentProxyRoutes(f);
    await f.ready();
    return f;
  }
  const post = (f: any, url: string, payload: any, key = AGENT_KEY) =>
    f.inject({ method: 'POST', url, headers: { authorization: `Bearer ${key}` }, payload });

  it('answers with Claude and records the cost as agent spend', async () => {
    script.push({ events: [{ type: 'message_start', message: { usage: {} } }], message: message('hello from claude') });
    const f = await app();
    const res = await post(f, '/api/freellmapi-proxy/v1/chat/completions', { model: 'gemini-3.1-flash-lite-preview', messages: [{ role: 'user', content: 'hi' }] });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ object: 'chat.completion', choices: [{ message: { content: 'hello from claude' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, prompt_tokens_details: { cached_tokens: 900 } } });
    expect(calls[0]).toMatchObject({ model: 'claude-sonnet-5-5', fallbacks: 'default', thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } } });
    expect(freeLlmApiCalls).toHaveLength(0);
    expect(ClaudeUsage.cycleSpend(new Date(0)).bySource.agent).toBeGreaterThan(0);
  });

  it('streams Claude as OpenAI chunks', async () => {
    script.push({
      events: [
        { type: 'message_start', message: { usage: { input_tokens: 5 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
      ],
      message: message('Hi'),
    });
    const f = await app();
    const res = await post(f, '/api/freellmapi-proxy/v1/chat/completions', { stream: true, messages: [{ role: 'user', content: 'hi' }] });
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.body).toContain('"content":"Hi"');
    expect(res.body.trim().endsWith('data: [DONE]')).toBe(true);
  });

  it('falls back to FreeLLMAPI when the credit is gone, and stops trying Claude', async () => {
    script.push({ error: apiError(402, 'billing_error', 'Your credit balance is too low') });
    const f = await app();
    const res = await post(f, '/api/freellmapi-proxy/v1/chat/completions', { model: 'x', messages: [{ role: 'user', content: 'hi' }] });
    expect(res.json()).toMatchObject({ id: 'free' });
    expect(freeLlmApiCalls[0].data.model).toBeUndefined(); // FreeLLMAPI routes on its own
    expect(ClaudeCreditState.availability('agent').state).toBe('credit_exhausted');

    await post(f, '/api/freellmapi-proxy/v1/chat/completions', { messages: [{ role: 'user', content: 'again' }] });
    expect(calls).toHaveLength(1);
    expect(freeLlmApiCalls).toHaveLength(2);
  });

  it('never spends Claude for an unknown key', async () => {
    const f = await app();
    await post(f, '/api/freellmapi-proxy/v1/chat/completions', { messages: [{ role: 'user', content: 'hi' }] }, 'unknown-key-789');
    expect(calls).toHaveLength(0);
    expect(freeLlmApiCalls).toHaveLength(1);
  });

  it('runs builds on the Claude build model, or on FreeLLMAPI with a non-Claude build model', async () => {
    const f = await app();
    script.push({ events: [], message: message('code', { model: 'claude-opus-5-5' }) });
    await post(f, '/api/freellmapi-proxy/builder/v1/chat/completions', { messages: [{ role: 'user', content: 'build' }] });
    expect(calls[0].model).toBe('claude-opus-5-5');
    expect(calls[0].output_config).toEqual({ effort: 'high' });

    updateBuildSettings({ model: 'qwen-coder' });
    await post(f, '/api/freellmapi-proxy/builder/v1/chat/completions', { messages: [{ role: 'user', content: 'build' }] });
    expect(calls).toHaveLength(1);
    expect(freeLlmApiCalls[0].data.model).toBe('qwen-coder');
    updateBuildSettings({ model: null });
  });
});
