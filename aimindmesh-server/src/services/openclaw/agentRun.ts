import { Logger } from '../../utils/Logger';
import { abortAgentRun, getLastAssistantReply, startAgentRun, waitForAgentRun } from '../OpenClawBridge';
import type { AgentRunner, AgentRunResult } from '../organization/venture/VentureBuildRun';

/**
 * OpenClaw provider (openclaw.json `models.providers`) pointing at the server's builder proxy route
 * (/api/freellmapi-proxy/builder/v1), which applies the model of the organization build settings.
 */
export const BUILDER_PROVIDER = 'aimindmesh-builder';

// The gateway stops the run itself a little after our own deadline
const GATEWAY_GRACE_S = 60;

/**
 * Agent runs with explicit outcomes, for callers that must not confuse a failure with a reply
 * (the venture build loop). runAgentTask keeps its historical behaviour for chat and AI tasks.
 *
 * The gateway gets the time budget (`timeout`, in seconds) and, when we stop waiting (timeout
 * or cancel), a `chat.abort`: no run keeps working on the session behind our back.
 */
export async function runStrict(
  prompt: string,
  sessionKey: string,
  options: { timeoutMs: number; signal?: AbortSignal; extraParams?: Record<string, unknown> },
): Promise<AgentRunResult> {
  if (options.signal?.aborted) return { status: 'cancelled', reply: '' };
  let runId: string;
  try {
    runId = await startAgentRun(prompt, sessionKey, {
      ...options.extraParams,
      timeout: Math.ceil(options.timeoutMs / 1000) + GATEWAY_GRACE_S,
    });
  } catch (err: any) {
    return { status: 'error', reply: '', error: err.message };
  }

  const event = await waitForAgentRun(runId, options.timeoutMs, options.signal);
  if (!event) {
    const status = options.signal?.aborted ? 'cancelled' : 'timeout';
    const aborted = await abortAgentRun(sessionKey, runId);
    Logger.warn('OpenClawAgentRun', `Run ${runId} on ${sessionKey}: ${status}${aborted ? ', aborted on the gateway' : ', abort not confirmed'}`);
    return { status, reply: '', error: status === 'timeout' ? `No result within ${Math.round(options.timeoutMs / 60_000)} min` : undefined };
  }
  if (event.phase === 'disconnected') return { status: 'disconnected', reply: '', error: event.error };
  if (event.phase === 'error') return { status: 'error', reply: '', error: event.error };

  const reply = event.output || await getLastAssistantReply(sessionKey);
  return { status: 'ok', reply };
}

export const openClawAgentRunner: AgentRunner = {
  run(prompt, sessionKey, { timeoutMs, signal, model }) {
    // A chosen build model goes through the builder provider; otherwise the agent's default model
    const extraParams = model ? { provider: BUILDER_PROVIDER, model } : undefined;
    return runStrict(prompt, sessionKey, { timeoutMs, signal, extraParams });
  },
};
