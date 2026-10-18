import crypto from 'crypto';
import { config } from '../../../../config';
import { tryAcquireClaude, type ClaudeTicket } from '../claudeGate';
import { claudeSettings, isClaudeModel, type ClaudeEffort } from '../claudeSettings';

export interface ClaudeAgentRoute {
  source: 'agent' | 'builder';
  model: string;
  effort: ClaudeEffort;
  ticket: ClaudeTicket;
}

const digest = (value: string) => crypto.createHash('sha256').update(value).digest();

/**
 * True when the Bearer key is one the server knows: its own FreeLLMAPI key (the one OpenClaw
 * and Hermes are given) or a key listed in claude.agents.proxyKeys. FreeLLMAPI checks the keys
 * of the requests it receives; on the Claude branch the server must, or anyone on the private
 * network could spend the Claude credit.
 */
export function agentKeyAllowed(authHeader: string): boolean {
  const presented = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!presented) return false;
  const allowed = [config.freellmapi?.apiKey, ...claudeSettings().agents.proxyKeys].filter((k): k is string => !!k && k.length >= 8);
  const p = digest(presented);
  return allowed.some(key => crypto.timingSafeEqual(p, digest(key)));
}

/**
 * Claude route for an agent request, or null when it goes to FreeLLMAPI: agents disabled,
 * unknown key, a non-Claude build model, Claude unavailable (credit, budget, key) or every
 * agent slot busy. The returned ticket must be released when the call ends.
 */
export function claudeAgentRoute(source: 'agent' | 'builder', authHeader: string, buildModel: string | null): ClaudeAgentRoute | null {
  const settings = claudeSettings();
  if (!settings.agents.enabled || !agentKeyAllowed(authHeader)) return null;
  let model: string;
  if (source === 'builder') {
    if (buildModel && !isClaudeModel(buildModel)) return null;
    model = buildModel || settings.agents.builderModel;
  } else {
    model = settings.agents.model;
  }
  const ticket = tryAcquireClaude('agents', source);
  if (!ticket) return null;
  // Builds write code (the EVOLUTION effort); the general agents use the STANDARD effort
  const effort = source === 'builder' ? settings.effort.EVOLUTION : settings.effort.STANDARD;
  return { source, model, effort, ticket };
}
