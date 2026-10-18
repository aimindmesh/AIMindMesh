import type { ClaudeTicket } from './claude/claudeGate';

export type TaskType = 'EVOLUTION' | 'INTENT_CLASSIFICATION' | 'QUERY_EXPANSION' | 'CONCEPT_EXTRACTION' | 'CONCEPT_ENRICHMENT' | 'IMPROVEMENT_DETECTION' |
                       'PROACTIVE_INSIGHT' | 'DEBATE_PARTICIPATION' | 'DEBATE_SUMMARY' | 'INSIGHT_DEDUP' |
                       'WIKI_SYNTHESIS' | 'WIKI_TOPIC_MAP' | 'CODE_EVOLUTION' | 'EVOLUTION_VALIDATION' |
                       'EMBEDDING_GENERATION' | 'GENERAL_CHAT' | 'WEB_RESEARCH' | 'AGENTIC_TASK' | 'SCHEDULED_TASK' |
                       'DIRECTIVES_EXTRACTION' | 'ORGANIZATION_DESIGN';
export type EngineType = 'OLLAMA' | 'GEMINI' | 'OPENROUTER' | 'MOBILE' | 'OPENCLAW' | 'HERMES' | 'CLAUDE' | 'CLAUDE_BATCH';

export interface TaskPayload {
  type: TaskType;
  prompt: string;
  tokensEstimate?: number;
  currentWaitMs?: number;
  retryCount?: number;
  options?: {
    routing?: string;
    model?: string;
    thinking?: boolean;
    sessionKey?: string;
    searchEnabled?: boolean;
    taskName?: string;
    /** Routing the caller asked for (dispatch overwrites `routing` with the target it chose) */
    requestedRouting?: string;
    /** Providers this task must not use again (they failed it) */
    skipProviders?: string[];
    /** Set only by background callers that can wait for a batch result (minutes to hours) */
    batchable?: boolean;
  };
  /** Web search results, fetched once: retries reuse them instead of searching again */
  searchContext?: string;
  /** Stable leading context shared by consecutive calls (prompt caching on Claude) */
  cachePrefix?: string;
  metadata?: any;
}

export interface QueueItem {
  id: string;
  payload: TaskPayload;
  resolve: (value: { provider: string, response: string }) => void;
  reject: (reason: any) => void;
  lastProvider?: string;
  onUpdate?: (update: any) => void;
  /** Claude call slot reserved at dispatch, released when the attempt ends */
  claudeTicket?: ClaudeTicket;
}

/** Why the router aborted a running attempt: only a stale lock is retried by the attempt itself. */
export type AbortReason = 'STALE_LOCK' | 'REROUTE' | 'CANCEL' | 'BRAKE' | 'RESET';

/** A task sent to a phone node over its socket, waiting for the node's result. */
export interface PendingMobileTask {
  callback: (result: any) => void;
  onUpdate?: (update: any) => void;
  cleanup: () => void;
  node: string;
}

export type CompletionListener = (id: string, result: string, metadata: any, type: TaskType) => Promise<void>;
