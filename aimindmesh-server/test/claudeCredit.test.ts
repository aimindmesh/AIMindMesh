import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import db from '../src/db/sqlite';
import { config } from '../src/config';
import { classifyClaudeError, ClaudeError, isRejectedBeta } from '../src/services/inference/claude/claudeErrors';
import { costUsd, emptyTokens, priceUsage } from '../src/services/inference/claude/claudePricing';
import { ClaudeCreditState } from '../src/services/inference/claude/ClaudeCreditState';
import { ClaudeUsage, cycleBounds } from '../src/services/inference/claude/ClaudeUsage';
import { normalizeClaudeSettings } from '../src/services/inference/claude/claudeSettings';
import { tryAcquireClaude } from '../src/services/inference/claude/claudeGate';
import { claudeStatus } from '../src/services/inference/claude/claudeStatus';

const apiError = (status: number, type: string, message: string) =>
  Anthropic.APIError.generate(status, { type: 'error', error: { type, message } }, undefined, new Headers());

beforeEach(() => {
  (config as any).claude = { apiKey: 'sk-ant-test-key-0000' };
  db.prepare('DELETE FROM claude_usage').run();
  ClaudeUsage.resetCache();
  ClaudeCreditState.reset();
});

afterEach(() => {
  (config as any).claude = { apiKey: '' };
  ClaudeCreditState.reset();
});

describe('claude settings', () => {
  it('applies defaults and rejects invalid values', () => {
    const s = normalizeClaudeSettings({ models: { STANDARD: 'gpt-4', COMPLEX: 'claude-opus-5' }, effort: { LIGHTWEIGHT: 'huge' }, billingCycleDay: 40, maxConcurrent: 0 });
    expect(s.models.STANDARD).toBe('claude-sonnet-5-5');
    expect(s.models.COMPLEX).toBe('claude-opus-5');
    expect(s.effort.LIGHTWEIGHT).toBe('low');
    expect(s.billingCycleDay).toBe(31);
    expect(s.maxConcurrent).toBe(1);
    expect(s.firstForCategories).toEqual(['STANDARD', 'COMPLEX', 'EVOLUTION', 'RESEARCH']);
    expect(s.agents.monthlyBudgetUsd).toBeNull();
  });
});

describe('claude errors', () => {
  it('classifies the organization-wide failures', () => {
    expect(classifyClaudeError(apiError(402, 'billing_error', 'no money')).kind).toBe('credit');
    expect(classifyClaudeError(apiError(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API.')).kind).toBe('credit');
    expect(classifyClaudeError(apiError(401, 'authentication_error', 'bad key')).kind).toBe('auth');
    expect(classifyClaudeError(apiError(404, 'not_found_error', 'model')).kind).toBe('unavailable');
  });

  it('classifies per-request failures', () => {
    expect(classifyClaudeError(apiError(429, 'rate_limit_error', 'slow down')).kind).toBe('transient');
    expect(classifyClaudeError(apiError(529, 'overloaded_error', 'busy')).kind).toBe('transient');
    expect(classifyClaudeError(apiError(400, 'invalid_request_error', 'messages: bad')).kind).toBe('invalid');
    expect(classifyClaudeError(new Error('socket hang up')).kind).toBe('transient');
    expect(classifyClaudeError(Object.assign(new Error('x'), { name: 'AbortError' })).kind).toBe('aborted');
    const own = new ClaudeError('refusal', 'declined');
    expect(classifyClaudeError(own)).toBe(own);
    expect(own.message).toBe('CLAUDE_REFUSAL: declined');
  });

  it('recognizes a rejected beta', () => {
    expect(isRejectedBeta(apiError(400, 'invalid_request_error', 'Unexpected value for the `anthropic-beta` header'))).toBe(true);
    expect(isRejectedBeta(apiError(400, 'invalid_request_error', 'messages.0: bad'))).toBe(false);
  });
});

describe('claude pricing', () => {
  it('prices input, output and cache tokens per model', () => {
    const t = { ...emptyTokens(), input: 1_000_000, output: 100_000, cacheRead: 1_000_000, cacheWrite5m: 1_000_000 };
    // Opus 5.5: 4 + 2 + 0.2 + 5 (write 1.25x)
    expect(costUsd('claude-opus-5-5', t)).toBeCloseTo(11.2);
    expect(costUsd('claude-opus-5-5', t, true)).toBeCloseTo(5.6);
  });

  it('uses the long-prompt prices of Haiku 5.5 above 100K tokens', () => {
    expect(costUsd('claude-haiku-5-5', { ...emptyTokens(), input: 100_000 })).toBeCloseTo(0.01);
    expect(costUsd('claude-haiku-5-5', { ...emptyTokens(), input: 200_000 })).toBeCloseTo(0.1);
  });

  it('prices each iteration at the model that served it', () => {
    const priced = priceUsage('claude-opus-5-5', 'claude-opus-5', {
      input_tokens: 2_000_000, output_tokens: 0,
      iterations: [
        { type: 'message', input_tokens: 1_000_000, output_tokens: 0 },
        { type: 'fallback_message', model: 'claude-opus-5', input_tokens: 1_000_000, output_tokens: 0 },
      ],
    });
    expect(priced.model).toBe('claude-opus-5');
    expect(priced.costUsd).toBeCloseTo(4 + 5);
    expect(priced.tokens.input).toBe(2_000_000);
  });
});

describe('billing cycle', () => {
  it('starts on the cycle day, or the last day of shorter months', () => {
    const { start, end } = cycleBounds(29, new Date('2026-10-18T10:00:00Z'));
    expect(start.toISOString().slice(0, 10)).toBe('2026-09-29');
    expect(end.toISOString().slice(0, 10)).toBe('2026-10-29');
    const feb = cycleBounds(29, new Date('2027-02-28T12:00:00Z'));
    expect(feb.start.toISOString().slice(0, 10)).toBe('2027-02-28');
    expect(feb.end.toISOString().slice(0, 10)).toBe('2027-03-29');
  });
});

describe('claude credit state', () => {
  it('is unavailable without a key', () => {
    (config as any).claude = { apiKey: '' };
    expect(ClaudeCreditState.availability().state).toBe('no_key');
    expect(tryAcquireClaude('router', 'router')).toBeNull();
  });

  it('blocks after a credit error, lets one probe through after the retry delay, clears on success', () => {
    const t0 = new Date();
    ClaudeCreditState.reportBlocking('credit_exhausted', 'no credit', t0);
    expect(ClaudeCreditState.availability('router', {}, t0)).toMatchObject({ state: 'credit_exhausted', available: false });

    const later = new Date(t0.getTime() + 7 * 3_600_000);
    expect(ClaudeCreditState.availability('router', {}, later)).toMatchObject({ available: true, probe: true });
    expect(ClaudeCreditState.availability('router', { allowProbe: false }, later).available).toBe(false);
    ClaudeCreditState.beginProbe();
    expect(ClaudeCreditState.availability('router', {}, later).available).toBe(false);
    ClaudeCreditState.endProbe();

    ClaudeCreditState.reportSuccess();
    expect(ClaudeCreditState.availability().state).toBe('ok');
  });

  it('clears a credit error in a new billing cycle and an auth error with a new key', () => {
    ClaudeCreditState.reportBlocking('credit_exhausted', 'no credit', new Date('2026-09-10T00:00:00Z'));
    expect(ClaudeCreditState.availability().state).toBe('ok');

    ClaudeCreditState.reportBlocking('auth_error', 'bad key');
    expect(ClaudeCreditState.availability().state).toBe('auth_error');
    expect(ClaudeCreditState.availability('router', {}, new Date(Date.now() + 30 * 86_400_000)).available).toBe(false);
    (config as any).claude = { apiKey: 'sk-ant-other-key-1111' };
    expect(ClaudeCreditState.availability().state).toBe('ok');
  });

  it('stops at the internal budget, counting reservations, and at the agent cap', () => {
    (config as any).claude = { apiKey: 'sk-ant-test-key-0000', monthlyBudgetUsd: 10, agents: { monthlyBudgetUsd: 2 } };
    const usage = (cost: number) => ({ model: 'claude-sonnet-5-5', tokens: emptyTokens(), costUsd: cost });
    ClaudeUsage.record('agent', 'realtime', usage(2.5));
    expect(ClaudeCreditState.availability('router').state).toBe('ok');
    expect(ClaudeCreditState.availability('agent').state).toBe('budget_reached');

    ClaudeUsage.record('router', 'realtime', usage(5));
    ClaudeUsage.registerReservations(() => ({ total: 3, bySource: { router: 3, agent: 0, builder: 0 } }));
    expect(ClaudeCreditState.availability('router')).toMatchObject({ state: 'budget_reached', available: false });
  });

  it('bounds concurrent calls per pool', () => {
    (config as any).claude = { apiKey: 'sk-ant-test-key-0000', maxConcurrent: 1 };
    const first = tryAcquireClaude('router', 'router');
    expect(first).not.toBeNull();
    expect(tryAcquireClaude('router', 'router')).toBeNull();
    expect(tryAcquireClaude('agents', 'agent')).not.toBeNull();
    first!.release();
    first!.release(); // idempotent
    expect(tryAcquireClaude('router', 'router')).not.toBeNull();
  });
});

describe('claude admin status', () => {
  it('reports state, cycle spend by source and today\'s tokens', () => {
    ClaudeUsage.record('router', 'realtime', { model: 'claude-sonnet-5-5', tokens: { ...emptyTokens(), input: 100, cacheRead: 300, output: 50 }, costUsd: 1.5 });
    ClaudeUsage.record('builder', 'batch', { model: 'claude-opus-5-5', tokens: emptyTokens(), costUsd: 0.5 });
    const status = claudeStatus();
    expect(status).toMatchObject({ enabled: true, configured: true, state: 'ok', agentsState: 'ok' });
    expect(status.cycle.spendUsd).toBeCloseTo(2);
    expect(status.cycle.bySource).toMatchObject({ router: 1.5, agent: 0, builder: 0.5 });
    expect(status.cycle.budgetUsd).toBe(200);
    expect(status.today).toMatchObject({ calls: 2, inputTokens: 100, cacheReadTokens: 300, outputTokens: 50 });
  });
});
