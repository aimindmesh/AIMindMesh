/**
 * Claude API prices in USD per million tokens (first-party API, as published on 2026-10-06),
 * used to estimate spend against the monthly budget. Cache writes cost 1.25x input (5-minute
 * TTL) or 2x (1 hour); cache reads have their own rate. The Batches API halves everything.
 */
interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  /** Haiku 5.5: prompts above this many tokens use the `long` prices */
  longAbove?: number;
  long?: { input: number; output: number; cacheRead: number };
}

const PRICES: Record<string, ModelPrice> = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, longAbove: 100_000, long: { input: 0.5, output: 2.5, cacheRead: 0.05 } },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 },
};

/** Unknown model ids are priced like the most expensive Opus tier, so the budget errs on the safe side. */
const UNKNOWN: ModelPrice = { input: 5, output: 25, cacheRead: 0.5 };

export interface TokenCounts {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

export const emptyTokens = (): TokenCounts => ({ input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 });

/** Price entry of a model id; dated or suffixed ids match their base id. */
function priceOf(model: string): ModelPrice {
  if (PRICES[model]) return PRICES[model];
  const base = Object.keys(PRICES).find(id => model.startsWith(`${id}-`) || model.startsWith(`${id}@`));
  return base ? PRICES[base] : UNKNOWN;
}

export function costUsd(model: string, t: TokenCounts, batch = false): number {
  const p = priceOf(model);
  const promptTokens = t.input + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h;
  const rates = p.longAbove !== undefined && p.long && promptTokens > p.longAbove ? p.long : p;
  const usd = (
    t.input * rates.input +
    t.cacheWrite5m * rates.input * 1.25 +
    t.cacheWrite1h * rates.input * 2 +
    t.cacheRead * rates.cacheRead +
    t.output * rates.output
  ) / 1_000_000;
  return batch ? usd / 2 : usd;
}

interface UsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation?: { ephemeral_5m_input_tokens?: number | null; ephemeral_1h_input_tokens?: number | null } | null;
  iterations?: Array<UsageLike & { type?: string; model?: string }> | null;
}

function tokensOf(u: UsageLike): TokenCounts {
  const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const write5m = u.cache_creation?.ephemeral_5m_input_tokens ?? Math.max(0, (u.cache_creation_input_tokens ?? 0) - write1h);
  return {
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheWrite5m: write5m,
    cacheWrite1h: write1h,
    cacheRead: u.cache_read_input_tokens ?? 0,
  };
}

export interface PricedUsage {
  /** Model that served the request (a server-side fallback may differ from the requested one) */
  model: string;
  tokens: TokenCounts;
  costUsd: number;
}

/**
 * Tokens and cost of one response. With server-side fallback the iterations list each model
 * that ran: every iteration is priced at its own model's rates.
 */
export function priceUsage(requestedModel: string, servedModel: string | undefined, usage: UsageLike, batch = false): PricedUsage {
  const iterations = usage.iterations ?? [];
  if (iterations.length === 0) {
    const model = servedModel || requestedModel;
    const tokens = tokensOf(usage);
    return { model, tokens, costUsd: costUsd(model, tokens, batch) };
  }
  const total = emptyTokens();
  let cost = 0;
  let model = requestedModel;
  for (const it of iterations) {
    const itModel = it.type === 'fallback_message' && it.model ? it.model : requestedModel;
    if (it.type === 'fallback_message' && it.model) model = it.model;
    const t = tokensOf(it);
    cost += costUsd(itModel, t, batch);
    for (const k of Object.keys(total) as (keyof TokenCounts)[]) total[k] += t[k];
  }
  return { model: servedModel || model, tokens: total, costUsd: cost };
}

/** Rough cost of a request before it runs (prompt length / 4 tokens, a quarter of max output). */
export function estimateCostUsd(model: string, promptChars: number, maxTokens: number, batch = false): number {
  const tokens = { ...emptyTokens(), input: Math.ceil(promptChars / 4), output: Math.ceil(maxTokens / 4) };
  return costUsd(model, tokens, batch);
}
