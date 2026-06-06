import * as fs from 'fs/promises';
import * as path from 'path';
import * as cron from 'node-cron';
import crypto from 'crypto';
import db from '../db/sqlite';
import { Logger } from '../utils/Logger';
import { InferenceRouter, TaskType } from './InferenceRouter';
import { config } from '../config';
import { AiTaskDefinition, AiTaskExecution } from '../types/aiTask';
import { documentIngester } from './DocumentIngester';
import { GiteaService } from './GiteaService';
import * as FCMDispatcher from './FCMDispatcher';
import { DeliveryScheduler } from './DeliveryScheduler';

// ─── Constants ────────────────────────────────────────────────────────────────

const TASKS_BASE_DIR: string = process.env.AI_TASKS_BASE_DIR ?? path.join(__dirname, '../../data/tasks');
const GITEA_TASKS_REPO: string = process.env.GITEA_TASKS_REPO ?? 'aimindmesh/ai-tasks-output';
const TIMEZONE: string = (config as any).proactive?.timezone ?? 'Europe/Rome';

export class AiTaskScheduler {
  private static cronJobs = new Map<string, cron.ScheduledTask>();
  private static timeouts = new Map<string, NodeJS.Timeout>();
  private static ingester = documentIngester;

  public static async init(): Promise<void> {
    this.migrateDB();
    await fs.mkdir(TASKS_BASE_DIR, { recursive: true });
    await this.reloadAllSchedules();
    Logger.info('AiTaskScheduler', 'Task engine initialized', { tasks: this.cronJobs.size + this.timeouts.size });
  }

  public static listTasks(): AiTaskDefinition[] {
    const rows = db.prepare('SELECT * FROM ai_tasks ORDER BY created_at DESC').all() as any[];
    return rows.map(this.rowToTask);
  }

  public static getTask(id: string): AiTaskDefinition | null {
    const row = db.prepare('SELECT * FROM ai_tasks WHERE id = ?').get(id) as any;
    return row ? this.rowToTask(row) : null;
  }

  public static createTask(def: Partial<AiTaskDefinition>): AiTaskDefinition {
    const now = Date.now();
    const task: AiTaskDefinition = { 
      id: def.id || crypto.randomUUID(),
      title: def.title || 'Untitled Task',
      promptTemplate: def.promptTemplate || '',
      model: def.model || '',
      provider: def.provider || 'auto',
      outputFormat: def.outputFormat || 'markdown',
      storagePolicy: def.storagePolicy || 'server_disk',
      requiresReview: def.requiresReview !== false,
      cronExpression: def.cronExpression,
      scheduledAt: def.scheduledAt,
      status: 'active',
      createdAt: now,
      updatedAt: now 
    };
    
    const dbData = {
      id: task.id,
      title: task.title,
      promptTemplate: task.promptTemplate,
      model: task.model,
      provider: task.provider,
      outputFormat: task.outputFormat,
      storagePolicy: task.storagePolicy,
      requiresReview: task.requiresReview ? 1 : 0,
      cronExpression: task.cronExpression ?? null,
      scheduledAt: task.scheduledAt ?? null,
      status: task.status,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    };

    db.prepare(`
      INSERT INTO ai_tasks (id, title, prompt_template, model, provider, output_format, storage_policy, requires_review, cron_expression, scheduled_at, status, created_at, updated_at)
      VALUES (@id, @title, @promptTemplate, @model, @provider, @outputFormat, @storagePolicy, @requiresReview, @cronExpression, @scheduledAt, @status, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET 
        title=excluded.title, prompt_template=excluded.prompt_template, model=excluded.model, provider=excluded.provider, 
        output_format=excluded.output_format, storage_policy=excluded.storage_policy, 
        requires_review=excluded.requires_review, cron_expression=excluded.cron_expression, 
        scheduled_at=excluded.scheduled_at, status=excluded.status, updated_at=excluded.updated_at
    `).run(dbData);

    this.unscheduleTask(task.id);
    if (task.status === 'active') this.scheduleTask(task);
    return task;
  }

  public static updateTask(taskId: string, updates: Partial<AiTaskDefinition>): AiTaskDefinition {
    const existing = this.getTask(taskId);
    if (!existing) throw new Error(`Task not found: ${taskId}`);
    const updated = { ...existing, ...updates, updatedAt: Date.now() };

    const dbData = {
      id: updated.id,
      title: updated.title,
      promptTemplate: updated.promptTemplate,
      model: updated.model,
      provider: updated.provider,
      outputFormat: updated.outputFormat,
      storagePolicy: updated.storagePolicy,
      requiresReview: updated.requiresReview ? 1 : 0,
      cronExpression: updated.cronExpression ?? null,
      scheduledAt: updated.scheduledAt ?? null,
      status: updated.status,
      updatedAt: updated.updatedAt
    };

    db.prepare(`
      UPDATE ai_tasks SET 
        title = @title, 
        prompt_template = @promptTemplate, 
        model = @model, 
        provider = @provider,
        output_format = @outputFormat, 
        storage_policy = @storagePolicy, 
        requires_review = @requiresReview, 
        cron_expression = @cronExpression, 
        scheduled_at = @scheduledAt, 
        status = @status, 
        updated_at = @updatedAt
      WHERE id = @id
    `).run(dbData);

    this.unscheduleTask(taskId);
    if (updated.status === 'active') this.scheduleTask(updated);
    return updated;
  }

  public static deleteTask(id: string): void {
    this.unscheduleTask(id);
    db.prepare('DELETE FROM ai_tasks WHERE id = ?').run(id);
  }

  public static pauseTask(taskId: string): void {
    const task = this.getTask(taskId);
    if (!task) return;
    this.unscheduleTask(taskId);
    db.prepare(`UPDATE ai_tasks SET status = 'paused', updated_at = ? WHERE id = ?`).run(Date.now(), taskId);
    Logger.info('AiTaskScheduler', `Task paused: ${task.title}`);
  }

  public static resumeTask(taskId: string): void {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    db.prepare(`UPDATE ai_tasks SET status = 'active', updated_at = ? WHERE id = ?`).run(Date.now(), taskId);
    task.status = 'active';
    this.scheduleTask(task);
    Logger.info('AiTaskScheduler', `Task resumed: ${task.title}`);
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private static scheduleTask(task: AiTaskDefinition): void {
    if (task.status !== 'active') return;
    if (task.cronExpression && cron.validate(task.cronExpression)) {
      const job = cron.schedule(task.cronExpression, () => this.executeTask(task.id).catch(err => Logger.error('AiTaskScheduler', `Cron error: ${err.message}`)), { timezone: TIMEZONE });
      this.cronJobs.set(task.id, job);
    } else if (task.scheduledAt && task.scheduledAt > Date.now()) {
      const timeout = setTimeout(() => {
        this.timeouts.delete(task.id);
        this.executeTask(task.id).catch(err => Logger.error('AiTaskScheduler', `One-shot error: ${err.message}`));
      }, task.scheduledAt - Date.now());
      this.timeouts.set(task.id, timeout);
    }
  }

  private static unscheduleTask(taskId: string): void {
    this.cronJobs.get(taskId)?.stop();
    this.cronJobs.delete(taskId);
    if (this.timeouts.has(taskId)) {
      clearTimeout(this.timeouts.get(taskId)!);
      this.timeouts.delete(taskId);
    }
  }

  private static async reloadAllSchedules(): Promise<void> {
    const tasks = this.listTasks();
    tasks.forEach(t => t.status === 'active' && this.scheduleTask(t));
  }

  public static async executeTask(taskId: string): Promise<AiTaskExecution> {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const execId = crypto.randomUUID();
    const now = Date.now();
    const exec: AiTaskExecution = { executionId: execId, taskId, status: 'running', startedAt: now, updatedAt: now };
    this.persistExecution(exec);

    Logger.info('AiTaskScheduler', `[Task:${task.title}] Dispatching execution ${execId.slice(0,8)}`);

    try {
      // ── Step 1: BUILD CONTEXT (Stub or KG integration) ─────────────────────
      const context = ""; // Simplified for now

      // ── Step 2: INFERENCE ───────────────────────────────────────────────────
      const taskType: TaskType = task.model === 'openclaw' ? 'AGENTIC_TASK' : 'SCHEDULED_TASK';
      
      Logger.info('AiTaskScheduler', `[Task:${task.title}] Calling InferenceRouter (Model: ${task.model})`);

      const routeResult = await InferenceRouter.routeTask({
        type: taskType,
        prompt: task.promptTemplate + (context ? `\n\nContext:\n${context}` : ""),
        options: {
          taskName: task.title,
          routing: task.provider !== 'auto' ? task.provider : undefined,
          model: task.model && task.model !== 'auto' ? task.model : undefined,
          sessionKey: task.provider === 'openclaw' ? `task:${task.id}:${execId}` : undefined,
          thinking: true
        }
      });

      const outputText = routeResult.response;
      if (!outputText || outputText.trim().length < 5) throw new Error('Empty or insufficient response from model.');
      exec.outputSummary = outputText.substring(0, 200).replace(/\n/g, ' ');

      // ── Step 3: PERSISTENCE (Local Disk) ────────────────────────────────────
      const taskDir = path.join(TASKS_BASE_DIR, taskId, execId);
      await fs.mkdir(taskDir, { recursive: true });
      
      const filename = `output-${new Date().toISOString().slice(0,10)}.${task.outputFormat === 'json' ? 'json' : 'md'}`;
      const artifactPath = path.join(taskDir, filename);
      
      await fs.writeFile(artifactPath, outputText, 'utf-8');
      await fs.writeFile(path.join(taskDir, 'meta.json'), JSON.stringify({ 
        taskId, 
        taskTitle: task.title, 
        executionId: execId, 
        model: routeResult.provider, 
        timestamp: new Date().toISOString() 
      }, null, 2));
      
      exec.artifactPath = artifactPath;

      // ── Step 4: EXTERNAL STORAGE (Gitea) ───────────────────────────────────
      if (task.storagePolicy === 'server_disk_gitea') {
        Logger.info('AiTaskScheduler', `[Task:${task.title}] Committing result to Gitea repo ${GITEA_TASKS_REPO}`);
        const commitUrl = await GiteaService.commitFile(
          GITEA_TASKS_REPO, 
          `tasks/${taskId}/${execId}/${filename}`, 
          outputText, 
          `AI Task: ${task.title}`
        ).catch(e => {
            Logger.warn('AiTaskScheduler', `Gitea commit failed: ${e.message}`);
            return null;
        });
        if (commitUrl) exec.giteaCommitUrl = commitUrl;
      }

      // ── Step 5: FEED & NOTIFICATION ────────────────────────────────────────
      Logger.info('AiTaskScheduler', `[Task:${task.title}] Finalizing execution status and delivery.`);
      
      // Add to main feed
      db.prepare(`INSERT INTO feed_items (id, type, content, created_at) VALUES (?, 'SYSTEM', ?, ?)`).run(
        execId, 
        `📋 **${task.title}**\n\n${outputText.substring(0, 50000)}`, 
        Date.now()
      );

      // Delivery via Scheduler (UI Sync)
      await DeliveryScheduler.deliver(execId, `✅ ${task.title}`, exec.outputSummary ?? 'Task complete');

      // Native Push
      await FCMDispatcher.sendToDevice(config.fcm?.testToken || '', {
         title: `AI Task: ${task.title}`,
         body: `Analysis complete. Result available in your feed.`
      }).catch(e => Logger.warn('AiTaskScheduler', `FCM notification failed: ${e.message}`));

      exec.status = task.requiresReview ? 'needs_review' : 'completed';

    } catch (err: any) {
      Logger.error('AiTaskScheduler', `[Task:${task.title}] Execution failure: ${err.message}`, { taskId, execId });
      exec.status = 'failed';
      exec.errorMessage = err.message;
    } finally {
      exec.completedAt = Date.now();
      exec.updatedAt = Date.now();
      this.persistExecution(exec);
      Logger.info('AiTaskScheduler', `[Task:${task.title}] Execution loop finished (Status: ${exec.status})`);
      
      // Enforce retention policy
      await this.enforceRetention(taskId).catch(e => Logger.warn('AiTaskScheduler', `Retention failed: ${e.message}`));
    }

    return exec;
  }

  public static approveExecution(execId: string): void {
    db.prepare(`UPDATE ai_task_executions SET status = 'completed', updated_at = ? WHERE execution_id = ? AND status = 'needs_review'`).run(Date.now(), execId);
  }

  public static getExecutions(taskId: string): AiTaskExecution[] {
    const rows = db.prepare(`SELECT * FROM ai_task_executions WHERE task_id = ? ORDER BY started_at DESC LIMIT 50`).all(taskId) as any[];
    return rows.map(this.rowToExec);
  }

  public static getAllExecutions(limit: number = 100): AiTaskExecution[] {
    const rows = db.prepare(`SELECT * FROM ai_task_executions ORDER BY started_at DESC LIMIT ?`).all(limit) as any[];
    return rows.map(this.rowToExec);
  }

  public static getExecution(execId: string): AiTaskExecution | null {
    const row = db.prepare(`SELECT * FROM ai_task_executions WHERE execution_id = ?`).get(execId) as any;
    return row ? this.rowToExec(row) : null;
  }

  public static async deleteExecution(execId: string): Promise<void> {
    const exec = this.getExecution(execId);
    if (!exec) return;

    if (exec.artifactPath) {
      try {
        await fs.unlink(exec.artifactPath);
      } catch (e: any) {
        if (e.code !== 'ENOENT') {
           Logger.warn('AiTaskScheduler', `Could not delete artifact file: ${e.message}`);
        }
      }
    }
    db.prepare(`DELETE FROM ai_task_executions WHERE execution_id = ?`).run(execId);
  }

  public static async enforceRetention(taskId: string): Promise<void> {
    const limit = config.tasks?.retentionLimit;
    if (!limit || limit <= 0) return; // Note: limit <= 0 means no limit or disabled

    const executions = this.getExecutions(taskId);
    if (executions.length <= limit) return;

    const toDelete = executions.slice(limit);
    for (const exec of toDelete) {
      await this.deleteExecution(exec.executionId);
    }
  }

  public static async readArtifact(execId: string): Promise<string | null> {
    const exec = this.getExecution(execId);
    if (!exec?.artifactPath) return null;
    return fs.readFile(exec.artifactPath, 'utf-8').catch(() => null);
  }

  private static migrateDB(): void {
    db.exec(`
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
    `);

    // Self-healing migration for provider column
    try {
      const tableInfo = db.prepare('PRAGMA table_info(ai_tasks)').all() as any[];
      if (!tableInfo.some(c => c.name === 'provider')) {
        db.exec("ALTER TABLE ai_tasks ADD COLUMN provider TEXT NOT NULL DEFAULT 'auto'");
        Logger.info('AiTaskScheduler', 'Added provider column to ai_tasks table');
      }
    } catch (e: any) {
      Logger.error('AiTaskScheduler', `Migration error: ${e.message}`);
    }
  }

  private static persistExecution(exec: AiTaskExecution): void {
    const dbData = {
      executionId: exec.executionId,
      taskId: exec.taskId,
      status: exec.status,
      startedAt: exec.startedAt ?? null,
      completedAt: exec.completedAt ?? null,
      errorMessage: exec.errorMessage ?? null,
      artifactPath: exec.artifactPath ?? null,
      giteaCommitUrl: exec.giteaCommitUrl ?? null,
      outputSummary: exec.outputSummary ?? null,
      updatedAt: exec.updatedAt
    };

    db.prepare(`
      INSERT INTO ai_task_executions (execution_id, task_id, status, started_at, completed_at, error_message, artifact_path, gitea_commit_url, output_summary, updated_at)
      VALUES (@executionId, @taskId, @status, @startedAt, @completedAt, @errorMessage, @artifactPath, @giteaCommitUrl, @outputSummary, @updatedAt)
      ON CONFLICT(execution_id) DO UPDATE SET 
        status=excluded.status, 
        completed_at=excluded.completed_at, 
        error_message=excluded.error_message, 
        artifact_path=excluded.artifact_path, 
        gitea_commit_url=excluded.gitea_commit_url, 
        output_summary=excluded.output_summary, 
        updated_at=excluded.updated_at
    `).run(dbData);
  }

  private static rowToTask(row: any): AiTaskDefinition {
    return { 
      ...row, 
      provider: row.provider || 'auto',
      promptTemplate: row.prompt_template, 
      outputFormat: row.output_format, 
      storagePolicy: row.storage_policy, 
      requiresReview: row.requires_review === 1, 
      cronExpression: row.cron_expression || undefined, 
      scheduledAt: row.scheduled_at || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private static rowToExec(row: any): AiTaskExecution {
    return { 
      ...row, 
      executionId: row.execution_id, 
      taskId: row.task_id, 
      startedAt: row.started_at, 
      completedAt: row.completed_at, 
      errorMessage: row.error_message, 
      artifactPath: row.artifact_path, 
      giteaCommitUrl: row.gitea_commit_url, 
      outputSummary: row.output_summary,
      updatedAt: row.updated_at
    };
  }
}
