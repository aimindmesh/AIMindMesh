/**
 * aiTask.ts
 *
 * Tipi condivisi per AI Tasks nel client PC.
 * Parallelo a types/calendar.ts nel progetto mobile.
 */

// ── Tipi base ──────────────────────────────────────────────────────────────

export type AiModel         = 'auto' | 'ollama' | 'gemini' | 'openclaw';
export type AiStoragePolicy = 'server_disk' | 'server_disk_gitea';
export type AiTaskStatus    = 'active' | 'paused';
export type AiExecutionStatus =
  | 'scheduled'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'needs_review';
export type AiOutputFormat  = 'markdown' | 'plain' | 'json' | 'pdf';

// ── Entità ─────────────────────────────────────────────────────────────────

export interface AiTaskExecution {
  executionId:     string;
  taskId:          string;
  status:          AiExecutionStatus;
  startedAt?:      number;
  completedAt?:    number;
  errorMessage?:   string;
  artifactPath?:   string;
  giteaCommitUrl?: string;
  outputSummary?:  string;
  updatedAt:       number;
}

export interface ServerAiTask {
  id:              string;
  title:           string;
  promptTemplate:  string;
  model:           AiModel;
  outputFormat:    AiOutputFormat;
  storagePolicy:   AiStoragePolicy;
  requiresReview:  boolean;
  cronExpression?: string;
  scheduledAt?:    number;
  status:          AiTaskStatus;
  createdAt:       number;
  updatedAt:       number;
  lastExecution?:  AiTaskExecution;
}

// ── Payloads ───────────────────────────────────────────────────────────────

export interface AiTaskCreatePayload {
  title:           string;
  promptTemplate:  string;
  model:           AiModel;
  outputFormat:    AiOutputFormat;
  storagePolicy:   AiStoragePolicy;
  requiresReview:  boolean;
  cronExpression?: string;
  scheduledAt?:    number;
}

export type AiTaskUpdatePayload = Partial<AiTaskCreatePayload>;

// ── UI helpers ─────────────────────────────────────────────────────────────

export const EXECUTION_STATUS_CONFIG: Record<AiExecutionStatus, {
  label: string; color: string; bg: string; pulse?: boolean
}> = {
  scheduled:    { label: '🕐 Scheduled',  color: 'text-blue-400',   bg: 'bg-blue-900/40'    },
  queued:       { label: '⏳ Queued',     color: 'text-yellow-400', bg: 'bg-yellow-900/40'  },
  running:      { label: '⚡ Running…',   color: 'text-orange-400', bg: 'bg-orange-900/40', pulse: true },
  completed:    { label: '✓ Completed',   color: 'text-green-400',  bg: 'bg-green-900/40'   },
  failed:       { label: '✗ Failed',      color: 'text-red-400',    bg: 'bg-red-900/40'     },
  needs_review: { label: '⚠ Needs Review',color: 'text-purple-400', bg: 'bg-purple-900/40'  },
};

export const CRON_PRESETS: Array<{ label: string; value: string }> = [
  { label: 'Ogni giorno alle 7:00',   value: '0 7 * * *'  },
  { label: 'Ogni giorno alle 8:00',   value: '0 8 * * *'  },
  { label: 'Ogni giorno alle 18:00',  value: '0 18 * * *' },
  { label: 'Ogni lunedì alle 8:00',   value: '0 8 * * 1'  },
  { label: 'Ogni domenica alle 9:00', value: '0 9 * * 0'  },
  { label: 'Ogni ora',                value: '0 * * * *'  },
  { label: 'Personalizzato…',         value: 'custom'      },
];
