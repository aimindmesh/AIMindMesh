import { config } from '../../../config';
import type { TaskCategory } from '../providerIds';

/**
 * Claude settings: the `claude` section of config.json with defaults applied on every read.
 * src/config.ts is not versioned (the VPS has its own copy), so it needs no change for this
 * section: it is read here, typed and validated.
 */

export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
/** Categories Claude serves: AGENTIC (tools) and EMBEDDING are not plain completions. */
export type ClaudeCategory = Exclude<TaskCategory, 'EMBEDDING' | 'AGENTIC'>;
export const CLAUDE_CATEGORIES: ClaudeCategory[] = ['LIGHTWEIGHT', 'STANDARD', 'COMPLEX', 'EVOLUTION', 'RESEARCH'];

export interface ClaudeBatchSettings {
  /** Background callers marked batchable go through the Message Batches API (half price) */
  enabled: boolean;
  /** Requests arriving within this window share one batch */
  windowMs: number;
  /** How often a pending batch is polled */
  pollMs: number;
}

export interface ClaudeAgentSettings {
  /** OpenClaw, Hermes and venture builds (the FreeLLMAPI proxy routes) use Claude first */
  enabled: boolean;
  /** Model of the general proxy route (OpenClaw, Hermes) */
  model: string;
  /** Model of venture builds when the build settings name none */
  builderModel: string;
  /** Bearer keys accepted on the Claude branch besides freellmapi.apiKey */
  proxyKeys: string[];
  maxConcurrent: number;
  /** Optional cap on agent + builder spend per billing cycle (null: only the global budget) */
  monthlyBudgetUsd: number | null;
}

export interface ClaudeSettings {
  enabled: boolean;
  apiKey: string;
  models: Record<ClaudeCategory, string>;
  effort: Record<ClaudeCategory, ClaudeEffort>;
  /** Categories where Claude goes first when their priority list does not place it */
  firstForCategories: ClaudeCategory[];
  maxTokens: number;
  /** Realtime calls of the router running at the same time */
  maxConcurrent: number;
  timeoutMs: number;
  /** Internal cap on the estimated spend per billing cycle (USD) */
  monthlyBudgetUsd: number;
  /** Day of the month the plan renews and the API credits refresh */
  billingCycleDay: number;
  /** After the API reports no credit, one probe request is let through every this many hours */
  exhaustedRetryHours: number;
  batch: ClaudeBatchSettings;
  agents: ClaudeAgentSettings;
}

export const CLAUDE_DEFAULTS: Readonly<ClaudeSettings> = Object.freeze({
  enabled: true,
  apiKey: '',
  models: {
    LIGHTWEIGHT: 'claude-haiku-5-5',
    STANDARD: 'claude-sonnet-5-5',
    RESEARCH: 'claude-sonnet-5-5',
    COMPLEX: 'claude-opus-5-5',
    EVOLUTION: 'claude-opus-5-5',
  },
  effort: {
    LIGHTWEIGHT: 'low',
    STANDARD: 'medium',
    RESEARCH: 'medium',
    COMPLEX: 'high',
    EVOLUTION: 'high',
  },
  firstForCategories: ['STANDARD', 'COMPLEX', 'EVOLUTION', 'RESEARCH'],
  maxTokens: 32000,
  maxConcurrent: 3,
  timeoutMs: 15 * 60_000,
  monthlyBudgetUsd: 200,
  billingCycleDay: 29,
  exhaustedRetryHours: 6,
  batch: { enabled: true, windowMs: 5_000, pollMs: 60_000 },
  agents: {
    enabled: true,
    model: 'claude-sonnet-5-5',
    builderModel: 'claude-opus-5-5',
    proxyKeys: [],
    maxConcurrent: 2,
    monthlyBudgetUsd: null,
  },
}) as ClaudeSettings;

const EFFORTS: ClaudeEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const CLAUDE_MODEL = /^claude-[a-z0-9.-]{1,60}$/;

export const isClaudeModel = (model: unknown): model is string => typeof model === 'string' && CLAUDE_MODEL.test(model);

function num(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return value !== null && value !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

export function normalizeClaudeSettings(raw: any): ClaudeSettings {
  const d = CLAUDE_DEFAULTS;
  const src = raw && typeof raw === 'object' ? raw : {};
  const models = { ...d.models };
  const effort = { ...d.effort };
  for (const cat of CLAUDE_CATEGORIES) {
    if (isClaudeModel(src.models?.[cat])) models[cat] = src.models[cat];
    if (EFFORTS.includes(src.effort?.[cat])) effort[cat] = src.effort[cat];
  }
  const first = Array.isArray(src.firstForCategories)
    ? src.firstForCategories.filter((c: unknown): c is ClaudeCategory => CLAUDE_CATEGORIES.includes(c as ClaudeCategory))
    : d.firstForCategories;
  const batch = src.batch ?? {};
  const agents = src.agents ?? {};
  return {
    enabled: bool(src.enabled, d.enabled),
    apiKey: typeof src.apiKey === 'string' ? src.apiKey.trim() : '',
    models,
    effort,
    firstForCategories: first,
    maxTokens: Math.round(num(src.maxTokens, 1024, 128_000, d.maxTokens)),
    maxConcurrent: Math.round(num(src.maxConcurrent, 1, 10, d.maxConcurrent)),
    timeoutMs: Math.round(num(src.timeoutMs, 30_000, 60 * 60_000, d.timeoutMs)),
    monthlyBudgetUsd: num(src.monthlyBudgetUsd, 0, 100_000, d.monthlyBudgetUsd),
    billingCycleDay: Math.round(num(src.billingCycleDay, 1, 31, d.billingCycleDay)),
    exhaustedRetryHours: num(src.exhaustedRetryHours, 0.25, 24 * 7, d.exhaustedRetryHours),
    batch: {
      enabled: bool(batch.enabled, d.batch.enabled),
      windowMs: Math.round(num(batch.windowMs, 0, 10 * 60_000, d.batch.windowMs)),
      pollMs: Math.round(num(batch.pollMs, 5_000, 60 * 60_000, d.batch.pollMs)),
    },
    agents: {
      enabled: bool(agents.enabled, d.agents.enabled),
      model: isClaudeModel(agents.model) ? agents.model : d.agents.model,
      builderModel: isClaudeModel(agents.builderModel) ? agents.builderModel : d.agents.builderModel,
      proxyKeys: Array.isArray(agents.proxyKeys) ? agents.proxyKeys.filter((k: unknown): k is string => typeof k === 'string' && k.length >= 8) : [],
      maxConcurrent: Math.round(num(agents.maxConcurrent, 1, 10, d.agents.maxConcurrent)),
      monthlyBudgetUsd: agents.monthlyBudgetUsd === null || agents.monthlyBudgetUsd === undefined
        ? null
        : num(agents.monthlyBudgetUsd, 0, 100_000, 0),
    },
  };
}

/** Current settings (cheap: called on every routing decision). */
export function claudeSettings(): ClaudeSettings {
  return normalizeClaudeSettings((config as unknown as { claude?: unknown }).claude);
}
