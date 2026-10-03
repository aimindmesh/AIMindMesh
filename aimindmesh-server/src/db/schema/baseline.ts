/**
 * Baseline schema of the operational SQLite database (migration v1).
 *
 * The CREATE statements are the historical ones, moved here verbatim from sqlite.ts,
 * DebateEngine.ts and AiTaskScheduler.ts. Columns added over time are applied by
 * migrations.ts (addColumnIfMissing), so the same baseline works on new databases
 * and on existing production ones.
 */
export const BASELINE_TABLES_SQL = `
-- Gemini per-key call log (api_key_hash added by migration v1)
CREATE TABLE IF NOT EXISTS gemini_calls (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  name TEXT,
  type TEXT NOT NULL,
  status TEXT DEFAULT 'OFFLINE',
  ollama_url TEXT,
  models TEXT,
  fcm_token TEXT,
  last_heartbeat INTEGER,
  registered_at INTEGER
);

CREATE TABLE IF NOT EXISTS feed_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  source_node_ids TEXT,
  created_at INTEGER,
  read_at INTEGER,
  reply_thread_id TEXT
);

CREATE TABLE IF NOT EXISTS feed_replies (
  id TEXT PRIMARY KEY,
  feed_item_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS gemini_usage (
  date TEXT PRIMARY KEY,
  call_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS openrouter_usage (
  date TEXT PRIMARY KEY,
  call_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_gemini_calls_timestamp ON gemini_calls(timestamp);

CREATE TABLE IF NOT EXISTS system_logs (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL,
  module TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata TEXT,
  timestamp INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_message_at INTEGER
);

CREATE TABLE IF NOT EXISTS direct_chats (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  used_node TEXT,
  timestamp INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS fcm_logs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  recipient TEXT NOT NULL,
  message TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id           TEXT PRIMARY KEY,
  doc_id       TEXT,
  status       TEXT NOT NULL DEFAULT 'PENDING',
  type         TEXT NOT NULL,
  source       TEXT NOT NULL,
  mime_type    TEXT,
  total_chunks INTEGER DEFAULT 0,
  done_chunks  INTEGER DEFAULT 0,
  error_msg    TEXT,
  mode         TEXT DEFAULT 'STANDARD',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON ingestion_jobs(status);

CREATE TABLE IF NOT EXISTS pending_delivery (
  id           TEXT PRIMARY KEY,
  insight_id   TEXT NOT NULL,
  device_id    TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  delivered_at INTEGER,
  status       TEXT NOT NULL DEFAULT 'PENDING',
  FOREIGN KEY (insight_id) REFERENCES feed_items(id)
);

CREATE INDEX IF NOT EXISTS idx_pending_device
  ON pending_delivery(device_id, status);

CREATE INDEX IF NOT EXISTS idx_pending_insight
  ON pending_delivery(insight_id, status);

CREATE TABLE IF NOT EXISTS node_settings (
  node_id       TEXT PRIMARY KEY,
  delivery_mode TEXT NOT NULL DEFAULT 'PUSH'
);

CREATE TABLE IF NOT EXISTS evolution_candidates (
  id              TEXT PRIMARY KEY,
  source          TEXT NOT NULL,
  source_id       TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  repository      TEXT NOT NULL DEFAULT 'AIMindMesh',
  target_component TEXT NOT NULL,
  target_language TEXT NOT NULL DEFAULT 'typescript',
  severity        REAL NOT NULL DEFAULT 5,
  confidence      REAL NOT NULL DEFAULT 0.5,
  proposed_approach TEXT,
  tags            TEXT,    -- JSON array
  created_at      INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS evolution_proposals (
  id              TEXT PRIMARY KEY,
  candidate_id    TEXT NOT NULL,
  title           TEXT NOT NULL,
  explanation     TEXT NOT NULL,
  branch_name     TEXT NOT NULL,
  pr_url          TEXT NOT NULL,
  pr_number       INTEGER NOT NULL,
  repository      TEXT NOT NULL DEFAULT 'AIMindMesh',
  target_component TEXT NOT NULL,
  impact          TEXT NOT NULL DEFAULT 'low',
  breaking_change INTEGER NOT NULL DEFAULT 0,
  commit_hash     TEXT,
  pre_merge_hash  TEXT,
  created_at      INTEGER NOT NULL,
  merged_at       INTEGER,
  rolled_back_at  INTEGER,
  rejected_at     INTEGER,
  status          TEXT NOT NULL DEFAULT 'proposed',
  FOREIGN KEY (candidate_id) REFERENCES evolution_candidates(id)
);

CREATE TABLE IF NOT EXISTS evolution_attempts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id    TEXT NOT NULL,
  failure_reason  TEXT NOT NULL,
  details         TEXT,
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (candidate_id) REFERENCES evolution_candidates(id)
);

CREATE TABLE IF NOT EXISTS protected_paths (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  path      TEXT NOT NULL UNIQUE,
  reason    TEXT,
  added_by  TEXT DEFAULT 'developer',
  added_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_proposals_status ON evolution_proposals(status);
CREATE INDEX IF NOT EXISTS idx_candidates_status ON evolution_candidates(status);
CREATE INDEX IF NOT EXISTS idx_candidates_severity ON evolution_candidates(severity DESC);

-- ── Sync & Common Memory (v4.2.0) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  duration INTEGER NOT NULL,
  has_audio INTEGER DEFAULT 0,
  audio_file_path TEXT,
  audio_mime_type TEXT,
  speaker_names_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meeting_segments (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  text TEXT NOT NULL,
  speaker_id INTEGER,
  stt_provider TEXT,
  confidence REAL,
  words_json TEXT,
  original_text TEXT,
  is_edited INTEGER DEFAULT 0,
  edited_at INTEGER,
  FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  is_all_day INTEGER DEFAULT 0,
  calendar_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_cursors (
  device_id TEXT PRIMARY KEY,
  last_sync_timestamp INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_logs (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  direction TEXT NOT NULL, -- 'UPLOAD' or 'DOWNLOAD'
  entity_type TEXT NOT NULL, -- 'meetings', 'calendar', 'memories'
  count INTEGER DEFAULT 0,
  status TEXT NOT NULL, -- 'SUCCESS', 'FAILED'
  error_msg TEXT,
  timestamp INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS evolution_feedback (
  id          TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  source      TEXT NOT NULL,
  author      TEXT,
  content     TEXT NOT NULL,
  labels      TEXT DEFAULT '[]',
  iteration   INTEGER DEFAULT 0,
  created_at  INTEGER NOT NULL,
  applied     INTEGER DEFAULT 0,
  FOREIGN KEY (proposal_id) REFERENCES evolution_proposals(id)
);

CREATE TABLE IF NOT EXISTS system_settings (
  id TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Inference queue (persisted tasks)
CREATE TABLE IF NOT EXISTS inference_queue (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  task_name TEXT,
  prompt TEXT,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  payload TEXT,
  result TEXT,
  error_msg TEXT,
  created_at INTEGER NOT NULL
);

-- Organization layer
CREATE TABLE IF NOT EXISTS organization_roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  mission TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  provider_preferences TEXT NOT NULL,
  tool_permissions TEXT NOT NULL,
  memory_namespace TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  approval_policy TEXT NOT NULL,
  can_recruit INTEGER NOT NULL DEFAULT 0,
  can_propose_repo INTEGER NOT NULL DEFAULT 0,
  can_provision_validation INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organization_directives (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  goal_type TEXT NOT NULL,
  constraints TEXT NOT NULL,
  priority INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL,
  supersedes_id TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organization_audit_log (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organization_ideas (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  problem_statement TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_signals TEXT NOT NULL,
  strategic_score REAL NOT NULL,
  feasibility_score REAL NOT NULL,
  novelty_score REAL NOT NULL,
  overall_score REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  analysis_synthesis TEXT,
  human_feedback TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organization_product_designs (
  id TEXT PRIMARY KEY,
  idea_id TEXT NOT NULL,
  scope_and_audience TEXT NOT NULL,
  ui_ux_design TEXT NOT NULL,
  core_logic TEXT NOT NULL,
  tech_stack TEXT NOT NULL,
  raw_markdown TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (idea_id) REFERENCES organization_ideas(id)
);

CREATE TABLE IF NOT EXISTS organization_role_proposals (
  id TEXT PRIMARY KEY,
  candidate_role_name TEXT NOT NULL,
  business_need TEXT NOT NULL,
  suggested_mission TEXT NOT NULL,
  suggested_prompt TEXT NOT NULL,
  required_permissions TEXT NOT NULL,
  confidence REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organization_repositories (
  id TEXT PRIMARY KEY,
  repo_name TEXT NOT NULL,
  namespace TEXT NOT NULL,
  gitea_url TEXT NOT NULL,
  created_from_idea_id TEXT,
  created_by_role_id TEXT,
  bootstrap_template TEXT NOT NULL,
  ci_cd_enabled INTEGER NOT NULL DEFAULT 0,
  validation_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organization_research_topics (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  query TEXT NOT NULL,
  interval_minutes INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organization_research_runs (
  id TEXT PRIMARY KEY,
  topic_id TEXT,
  mode TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  query TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organization_research_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  snippet TEXT NOT NULL,
  source TEXT NOT NULL,
  score REAL,
  raw TEXT
);

CREATE TABLE IF NOT EXISTS organization_research_summaries (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  key_points TEXT NOT NULL,
  risks TEXT NOT NULL,
  opportunities TEXT NOT NULL,
  recommended_follow_ups TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organization_discovery_config (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  enabled INTEGER NOT NULL DEFAULT 1,
  cron_expression TEXT NOT NULL DEFAULT '0 */12 * * *',
  max_topics_per_cycle INTEGER NOT NULL DEFAULT 3,
  min_score_threshold REAL NOT NULL DEFAULT 0.55,
  auto_council INTEGER NOT NULL DEFAULT 0,
  min_auto_council_score REAL NOT NULL DEFAULT 0.75,
  last_run_at TEXT,
  updated_at TEXT NOT NULL
);

-- Debate engine
CREATE TABLE IF NOT EXISTS debate_threads (
  id              TEXT PRIMARY KEY,
  insight_id      TEXT NOT NULL,
  insight_content TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'ACTIVE',
  current_round   INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  merged_into     TEXT
);

CREATE TABLE IF NOT EXISTS debate_messages (
  id         TEXT PRIMARY KEY,
  debate_id  TEXT NOT NULL,
  author     TEXT NOT NULL,
  content    TEXT NOT NULL,
  round      INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (debate_id) REFERENCES debate_threads(id)
);

CREATE INDEX IF NOT EXISTS idx_debate_insight  ON debate_threads(insight_id);
CREATE INDEX IF NOT EXISTS idx_debate_messages ON debate_messages(debate_id, round);

-- AI task scheduler
CREATE TABLE IF NOT EXISTS ai_tasks (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, prompt_template TEXT NOT NULL, model TEXT NOT NULL DEFAULT '', provider TEXT NOT NULL DEFAULT 'auto',
  output_format TEXT NOT NULL DEFAULT 'markdown', storage_policy TEXT NOT NULL DEFAULT 'server_disk',
  requires_review INTEGER NOT NULL DEFAULT 1, cron_expression TEXT, scheduled_at INTEGER,
  status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_task_executions (
  execution_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, status TEXT NOT NULL, started_at INTEGER, completed_at INTEGER,
  error_message TEXT, artifact_path TEXT, gitea_commit_url TEXT, output_summary TEXT, updated_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES ai_tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ai_task_executions_task_id ON ai_task_executions(task_id);
`;
