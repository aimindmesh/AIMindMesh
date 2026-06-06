/**
 * Calendar Types
 * Type definitions for the Agenda/Calendar module including Tasks
 */

// ========================================
// CALENDAR TASK TYPES
// ========================================

/**
 * Task status for Kanban board columns
 */
export type TaskStatus = 'backlog' | 'todo' | 'in-progress' | 'review' | 'done';

/**
 * Task priority levels
 */
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

/**
 * Recurrence rule for recurring tasks
 */
export interface RecurrenceRule {
    type: 'daily' | 'weekly' | 'monthly';
    interval: number; // Every N days/weeks/months
    daysOfWeek?: number[]; // [0-6] for weekly tasks (0 = Sunday)
    endDate?: number | null; // Stop generating after this date (timestamp)
}

/**
 * Calendar Task - main task entity
 */
export interface CalendarTask {
    // Identification
    id: string;

    // Content
    title: string;
    description: string;

    // Status Management
    status: TaskStatus;
    priority: TaskPriority;

    // Timestamps (stored as milliseconds since epoch)
    createdAt: number;
    dueDate: number;
    completedAt?: number;

    // Organization
    category?: string;
    tags: string[];

    // Assignment (for future multi-user support)
    assignedTo?: string;

    // Time Tracking
    estimatedHours?: number;
    actualHours?: number;

    // Relationships
    parentTaskId?: string; // For subtasks
    linkedEventId?: string; // Link to calendar event

    // Recurrence
    recurrenceRule?: RecurrenceRule;
    recurrenceParentId?: string; // Links to original recurring task

    // UI Metadata
    color?: string;
    order: number;

    // Pomodoro Tracking
    pomodoroCount: number;
    pomodoroTarget?: number;

    // AI Delegation
    assignee?: 'user' | 'ai';
    aiConfig?: AiTaskConfig; 
}

/**
 * Subtask - simplified task for checklists within parent tasks
 */
export interface Subtask {
    id: string;
    parentId: string;
    title: string;
    completed: boolean;
    order: number;
}

/**
 * Task statistics for dashboard
 */
export interface TaskStats {
    total: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
    overdue: number;
    completedThisWeek: number;
    completionRate: number;
}

/**
 * Kanban board structure
 */
export type KanbanBoard = Record<TaskStatus, CalendarTask[]>;

/**
 * Task filter options
 */
export interface TaskFilterOptions {
    priority?: TaskPriority[];
    tags?: string[];
    dateRange?: { start: Date; end: Date };
    hasSubtasks?: boolean;
    hasPomodoroTarget?: boolean;
    assignee?: 'user' | 'ai';
}

/**
 * Create task input (omitting auto-generated fields)
 */
export type CreateTaskInput = Omit<CalendarTask, 'id' | 'createdAt' | 'order' | 'pomodoroCount'>;

/**
 * Update task input (partial update)  
 */
export type UpdateTaskInput = Partial<Omit<CalendarTask, 'id' | 'createdAt'>>;

// ========================================
// AI TASK SCHEDULER TYPES
// ========================================

/** Chi esegue il task: l'utente (default) oppure il server AI */
export type TaskAssignee = 'user' | 'ai';

/** Modello AI da usare sul server */
export type AiModel = 'auto' | 'ollama' | 'gemini' | 'openclaw';

/** Policy di salvataggio output sul server */
export type AiStoragePolicy = 'server_disk' | 'server_disk_gitea';

/** Stato dell'ultima (o corrente) esecuzione AI */
export type AiExecutionStatus =
  | 'scheduled'     // in attesa del trigger
  | 'queued'        // nella coda del server
  | 'running'       // il modello sta generating
  | 'completed'     // esecuzione riuscita
  | 'failed'        // errore
  | 'needs_review'; // output pronto, l'utente deve approvare

/** Dati dell'ultima esecuzione — popolati dal server */
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

/** Configurazione delegazione AI — presente su CalendarTask solo se assignee === 'ai' */
export interface AiTaskConfig {
  model: AiModel;
  promptTemplate: string;
  outputFormat: 'markdown' | 'plain' | 'json' | 'pdf';
  storagePolicy: AiStoragePolicy;
  requiresReview: boolean;
  cronExpression?: string;   // es. '0 7 * * *'
  scheduledAt?: number;      // timestamp ms per task one-shot
  lastExecution?: AiTaskExecution;
}

// ─── Espressioni cron predefinite (usate nel picker del modal) ─────────────
export const CRON_PRESETS: Array<{ label: string; value: string }> = [
  { label: 'Ogni giorno alle 7:00',    value: '0 7 * * *'   },
  { label: 'Ogni giorno alle 8:00',    value: '0 8 * * *'   },
  { label: 'Ogni giorno alle 18:00',   value: '0 18 * * *'  },
  { label: 'Ogni lunedì alle 8:00',    value: '0 8 * * 1'   },
  { label: 'Ogni domenica alle 9:00',  value: '0 9 * * 0'   },
  { label: 'Ogni ora',                 value: '0 * * * *'   },
  { label: 'Personalizzato…',          value: 'custom'       },
];
