/**
 * HTTP API contract shared by the server and its clients (desktop, admin mobile, mobile).
 *
 * Types only and NO imports: clients compile this file directly (path alias
 * `@aimindmesh/api-types`, always with `import type`), so it must not pull in
 * server dependencies. Field names follow what the routes actually return:
 * snake_case for raw SQLite rows, camelCase where a route maps them.
 */

// ── Common ───────────────────────────────────────────────────────────────────

export interface SuccessResponse {
  success: boolean;
  message?: string;
  error?: string;
}

// ── AI tasks (/api/ai-tasks) ─────────────────────────────────────────────────

/** Where a task runs. Legacy rows may carry the provider name in `model` instead. */
export type AiProvider = 'auto' | 'ollama' | 'gemini' | 'openrouter' | 'claude' | 'openclaw';
/** Whether the schedule is enabled. */
export type AiTaskState = 'active' | 'paused';
/** Status of a single execution. */
export type AiExecutionStatus = 'scheduled' | 'queued' | 'running' | 'completed' | 'failed' | 'needs_review';
export type AiStoragePolicy = 'server_disk' | 'server_disk_gitea';
export type AiOutputFormat = 'markdown' | 'plain' | 'json' | 'pdf';

export interface AiTaskExecution {
  executionId: string;
  taskId: string;
  status: AiExecutionStatus;
  startedAt?: number;
  completedAt?: number;
  errorMessage?: string;
  artifactPath?: string;
  giteaCommitUrl?: string;
  outputSummary?: string;
  updatedAt: number;
}

export interface AiTaskDefinition {
  id: string;
  title: string;
  promptTemplate: string;
  /** Explicit model id; empty/'auto' lets the provider choose */
  model: string;
  provider: AiProvider;
  outputFormat: string;
  storagePolicy: AiStoragePolicy;
  requiresReview: boolean;
  cronExpression?: string;
  scheduledAt?: number;
  status: AiTaskState;
  createdAt: number;
  updatedAt: number;
}

/** GET /api/ai-tasks and GET /api/ai-tasks/:id */
export interface ApiAiTask extends AiTaskDefinition {
  lastExecution?: AiTaskExecution;
}

/** POST /api/ai-tasks (PATCH /api/ai-tasks/:id takes a Partial) */
export interface AiTaskCreatePayload {
  title: string;
  promptTemplate: string;
  model?: string;
  provider?: AiProvider;
  outputFormat?: string;
  storagePolicy?: AiStoragePolicy;
  requiresReview?: boolean;
  cronExpression?: string;
  scheduledAt?: number;
}

// ── Documents (/api/documents) ───────────────────────────────────────────────

export type IngestionJobState =
  | 'PENDING' | 'EXTRACTING' | 'CHUNKING' | 'VECTORIZING' | 'INDEXING' | 'DONE' | 'ERROR' | 'SKIPPED' | 'CANCELLED';

export interface IngestionJob {
  id: string;
  status: IngestionJobState;
  docId?: string;
  source: string;
  totalChunks: number;
  doneChunks: number;
  /** 0-100 */
  progress: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface KGDocument {
  id: string;
  title: string;
  source: string;
  mimeType: string;
  chunkCount: number;
  date: number;
}

// ── Organization (/api/organization) ─────────────────────────────────────────

export type DirectiveGoalType = 'explore' | 'build' | 'improve' | 'stop' | 'pivot' | 'research';
export type DirectiveStatus = 'active' | 'completed' | 'cancelled';
export type RoleStatus = 'active' | 'paused' | 'archived';
export type ProposalStatus = 'proposed' | 'approved' | 'rejected' | 'materialized';
export type IdeaStatus = 'proposed' | 'reviewing' | 'approved' | 'rejected' | 'characterized' | 'development' | 'mvp_ready' | 'killed';

export interface Directive {
  id: string;
  title: string;
  description: string;
  goalType: DirectiveGoalType;
  constraints: Record<string, any>;
  priority: number;
  status: DirectiveStatus;
  createdBy: string;
  supersedesId?: string | null;
  /** Idea the directive was derived from (council recommendations); null = organization-wide. */
  ideaId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrgRole {
  id: string;
  name: string;
  description: string;
  mission: string;
  systemPrompt: string;
  providerPreferences: Record<string, any>;
  toolPermissions: string[];
  memoryNamespace: string;
  status: RoleStatus;
  approvalPolicy: Record<string, any>;
  canRecruit: boolean;
  canProposeRepo: boolean;
  canProvisionValidation: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface RoleCreationProposal {
  id: string;
  candidateRoleName: string;
  businessNeed: string;
  suggestedMission: string;
  suggestedPrompt: string;
  requiredPermissions: string[];
  confidence: number;
  sourceSignals: string[];
  status: ProposalStatus;
  createdAt: string;
  updatedAt: string;
}

/** A web page an idea was derived from. */
export interface SourceRef {
  title: string;
  url: string;
}

export interface IdeaProposal {
  id: string;
  title: string;
  problemStatement: string;
  summary: string;
  /** Plain strings (rendered as text by older apps); structured links are in `sources`. */
  sourceSignals: string[];
  sources?: SourceRef[];
  strategicScore: number;
  feasibilityScore: number;
  noveltyScore: number;
  overallScore: number;
  status: IdeaStatus;
  /** Council debate synthesis (GET /ideas) */
  analysisSynthesis?: string | null;
  humanFeedback?: string | null;
  /** Why the discovery judge gave these scores. */
  judgeRationale?: string | null;
  /** Reason given when the venture was closed or pivoted. */
  outcomeNotes?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Raw organization_audit_log row */
export interface AuditLogEntry {
  id: string;
  event_type: string;
  actor_type: string;
  actor_id: string;
  target_type: string;
  target_id: string;
  payload: string;
  created_at: string;
}

/**
 * validation_status of a venture repository. `blocked` waits for a human (attempt budget spent,
 * paused by an upgrade); older rows may still hold `needs_verification` or `verifying`.
 */
export type VentureRepoStatus =
  'pending' | 'evolving' | 'cooldown' | 'verifying' | 'needs_verification' | 'healthy' | 'broken' | 'blocked';

/** One milestone of a venture: the acceptance criteria (AC ids) it must make pass. */
export interface VentureMilestone {
  seq: number;
  title: string;
  criteria: string[];
  status: 'pending' | 'in_progress' | 'done';
  attempts: number;
  /** Criteria passing at the last validation. */
  passed: string[];
}

/** POST /api/organization/ideas/:id/decision, once the MVP is ready. */
export type VentureDecision = 'continue' | 'pivot' | 'kill';

/** GET /api/organization/repositories row (snake_case, as stored). */
export interface VentureRepository {
  id: string;
  repo_name: string;
  namespace: string;
  gitea_url: string;
  created_from_idea_id: string | null;
  bootstrap_template: string;
  validation_status: VentureRepoStatus | string;
  retry_count: number;
  cooldown_until: string | null;
  blocked_reason: string | null;
  agent_last_triggered_at: string | null;
  last_ci_status: string | null;
  created_at: string;
  /** A development run or validation is in progress. */
  isEvolving: boolean;
  /** OpenClaw session of the development agent (log viewer). */
  sessionKey: string;
  /** Summary of the last validation, when there is one. */
  lastValidation?: string | null;
  milestones?: VentureMilestone[];
}

/** GET/PATCH /api/organization/build-config: the venture build loop and its kill switch. */
export interface VentureBuildConfig {
  enabled: boolean;
  /** Model of the development agent; null keeps the OpenClaw default. */
  model: string | null;
  maxAttempts: number;
  dailyRunLimit: number;
  maxConcurrentBuilds: number;
  /** Development runs a venture may use in total before it is blocked. */
  maxRunsPerVenture: number;
  agentRunTimeoutMs: number;
  validationImage: string;
  validationTimeoutMs: number;
}

export interface DiscoveryConfig {
  enabled: boolean;
  cronExpression: string;
  maxTopicsPerCycle: number;
  minScoreThreshold: number;
  autoCouncil: boolean;
  minAutoCouncilScore: number;
  lastRunAt: string | null;
  updatedAt: string;
  isRunning?: boolean;
}

// ── Auto-evolution (/api/evolution) ──────────────────────────────────────────

/** GET /api/evolution/stats row: what each candidate source turned into. */
export interface EvolutionSourceStats {
  source: string;
  candidates: number;
  /** Candidates whose generation or validation failed. */
  failed: number;
  /** Candidates the model declined to change. */
  skipped: number;
  proposals: number;
  merged: number;
  rejected: number;
}

export type EvolutionProposalStatus = 'proposed' | 'merged' | 'rejected' | 'failed' | 'rolled_back';

/** Raw evolution_proposals row; GET /proposals adds the joined candidate fields. SQLite booleans are 0/1. */
export interface EvolutionProposalRow {
  id: string;
  candidate_id: string;
  title: string;
  explanation: string;
  branch_name: string;
  pr_url: string;
  pr_number: number;
  repository: string;
  target_component: string;
  impact: string;
  breaking_change: 0 | 1;
  commit_hash: string | null;
  created_at: number;
  merged_at: number | null;
  rejected_at: number | null;
  status: EvolutionProposalStatus;
  feedback_status?: string | null;
  candidate_title?: string | null;
  candidate_description?: string | null;
}

/** Raw evolution_candidates row (tags / affected_components are JSON arrays as text). */
export interface EvolutionCandidateRow {
  id: string;
  source: string;
  source_id: string;
  title: string;
  description: string;
  repository: string;
  target_component: string;
  target_language: string;
  severity: number;
  confidence: number;
  proposed_approach: string | null;
  tags: string | null;
  affected_components?: string | null;
  change_scope?: string | null;
  created_at: number;
  status: string;
}

/** Raw protected_paths row */
export interface ProtectedPathRow {
  id: number;
  path: string;
  reason: string | null;
  added_by: string;
  added_at: number;
}

// ── Feed (/api/feed) ─────────────────────────────────────────────────────────

export interface FeedItem {
  id: string;
  type: 'INSIGHT' | 'SYSTEM' | 'NOTIFICATION';
  content: string;
  source_node_ids?: string;
  created_at: number;
  read_at: number | null;
  reply_thread_id: string | null;
}

export interface FeedReply {
  id: string;
  feed_item_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: number;
}

// ── Neural Wiki (/api/wiki) ──────────────────────────────────────────────────

export interface WikiPage {
  slug: string;
  folder?: string;
  title: string;
  /** Markdown body (no frontmatter) */
  body: string;
  neo4jId?: string;
  tags: string[];
  sources?: { type: string; id: string }[];
  /** ISO 8601 */
  updatedAt: string;
}

export interface WikiPageSummary {
  slug: string;
  folder?: string;
  title: string;
  tags: string[];
  updatedAt: string;
  neo4jId?: string;
}

// ── Nodes & server status (/api/nodes, /api/admin/status) ────────────────────

export interface ServerNode {
  id: string;
  name?: string | null;
  type: string;
  status: string;
  ollama_url?: string | null;
  models?: string[];
  last_heartbeat?: number | null;
  registered_at?: number | null;
  url?: string;
  address?: string;
  version?: string;
}

export interface FcmStatus {
  configured: boolean;
  path: string;
}

export interface ServiceHealth {
  isHealthy: boolean;
  statusMessage: string;
  lastCheck: number;
}

/** Claude availability: errors the API reports for the whole organization block it until they clear */
export type ClaudeStateName = 'ok' | 'no_key' | 'credit_exhausted' | 'budget_reached' | 'auth_error' | 'unavailable';

export interface ClaudeStatus {
  enabled: boolean;
  /** An API key is set */
  configured: boolean;
  state: ClaudeStateName;
  reason?: string;
  /** After a credit or availability error: when one probe call is let through (epoch ms) */
  nextProbeAt?: number;
  /** Agents (OpenClaw, Hermes, builds) may differ: they also have their own optional budget */
  agentsState: ClaudeStateName;
  agentsEnabled: boolean;
  cycle: {
    start: string;
    end: string;
    spendUsd: number;
    /** Estimated cost of batch requests still running */
    reservedUsd: number;
    budgetUsd: number;
    agentBudgetUsd: number | null;
    bySource: { router: number; agent: number; builder: number };
  };
  today: { calls: number; inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number; costUsd: number };
  inFlight: { router: number; agents: number };
  pendingBatchRequests: number;
}

export interface ServerStatus {
  nodes: ServerNode[];
  geminiUsage: number;
  openrouterUsage: number;
  cpu: number;
  ram: { total: string; used: string; percent: number };
  coreCount?: number;
  fcmStatus: FcmStatus;
  dailyQuotaCap?: number;
  openrouterDailyQuotaCap?: number;
  inferenceQueue?: unknown[];
  runningTasksCount?: number;
  openrouterCredits?: unknown;
  infrastructureBrake?: boolean;
  openClawHealth?: ServiceHealth;
  hermesHealth?: ServiceHealth;
  ingestionStats?: unknown;
  claude?: ClaudeStatus;
}

// --- Backups (/api/admin/backups) ---

/** POST /backups/restore: the restore is staged and applied at the next server start */
export interface RestoreStagedResponse {
  ok: boolean;
  /** true when the server exits right away and its supervisor (Docker, pm2) restarts it */
  restarting: boolean;
  message: string;
}

/** GET /backups/restore-status */
export interface RestoreStatus {
  pending: { filename: string; attempts: number } | null;
  last: { ok: boolean; error?: string; filename: string; at: number } | null;
}

// --- Mobile sync (/api/sync) ---

/** POST /api/sync/push */
export interface SyncPushResponse {
  ok: boolean;
  timestamp: number;
  /** Memories the graph did not store: the device keeps them unsynced and retries */
  failedMemoryIds: string[];
}

/** Row of direct_chats as returned by GET /api/sync/pull (id is `${conversation_id}:${local id}`) */
export interface SyncChatMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | string;
  content: string;
  used_node: string | null;
  timestamp: number;
  device_id: string | null;
  received_at: number | null;
}

/**
 * A meeting as pushed by a device and returned by the pull. The notes fields are sent by app
 * versions that have them; a pushed meeting without them keeps the stored notes.
 */
export interface SyncMeeting {
  id: string;
  timestamp: number;
  /** Seconds */
  duration: number;
  has_audio: number | boolean;
  audio_file_path?: string | null;
  audio_mime_type?: string | null;
  speaker_names_json?: string | null;
  title?: string | null;
  /** JSON: [{ id, ms, note? }] */
  bookmarks_json?: string | null;
  /** JSON: the structured AI notes of the meeting */
  analysis_json?: string | null;
  /** JSON: [{ id, question, answer, createdAt }] */
  questions_json?: string | null;
  device_id?: string;
  created_at?: number;
  updated_at?: number;
}

export interface SyncMeetingSegment {
  id: string;
  meeting_id: string;
  sequence: number;
  start_ms: number;
  end_ms: number;
  text: string;
  speaker_id?: number | null;
  stt_provider?: string | null;
  confidence?: number | null;
  words_json?: string | null;
  original_text?: string | null;
  is_edited?: number | boolean;
  edited_at?: number | null;
}

/** GET /api/sync/pull?deviceId=&since= (since = `timestamp` of the previous pull, server time) */
export interface SyncPullResponse {
  deviceId: string;
  timestamp: number;
  meetings: SyncMeeting[];
  meetingSegments: SyncMeetingSegment[];
  calendarEvents: any[];
  chats: SyncChatMessage[];
  conversations: { id: string; title: string; created_at: number; last_message_at: number | null }[];
  /** Meetings/segments deleted on other devices since `since` (apply locally, never re-push) */
  deletions: SyncDeletion[];
}

/** A deleted meeting (with its segments) or segment: pushed as `deletions`, returned by the pull */
export interface SyncDeletion {
  type: 'meeting' | 'segment';
  id: string;
  deletedAt: number;
}

// --- App chat streaming (/ws/chat?mode=completion) ---

export interface ChatCompletionRequest {
  type: 'completion';
  /** Chosen by the client, echoed by every event of this completion */
  requestId: string;
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[];
  options?: { routing?: string; thinking?: boolean; searchEnabled?: boolean };
}

/** `ack` right away (request accepted), then deltas/thoughts, then `done` or `error` */
export type ChatCompletionEvent =
  | { type: 'ack'; requestId: string }
  | { type: 'delta'; requestId: string; content: string }
  | { type: 'thought'; requestId: string; content: string }
  | { type: 'done'; requestId: string; usedNode: string }
  | { type: 'error'; requestId?: string; message: string };
