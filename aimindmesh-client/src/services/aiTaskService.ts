/**
 * aiTaskService.ts
 *
 * Axios client for the /api/ai-tasks APIs on the VPS server.
 * The PC client DOES NOT have a local DB: all persistence is on the server.
 *
 * Uses Zustand's configStore to read serverUrl and apiKey.
 */

import axios, { AxiosInstance } from 'axios';
import { useConfigStore } from '../store/configStore';
import {
  ServerAiTask, AiTaskCreatePayload, AiTaskUpdatePayload,
  AiTaskExecution
} from '../types/aiTask';

// ── Create axios instance with dynamic config ─────────────────────────────────

function createClient(): AxiosInstance {
  const { config } = useConfigStore.getState();
  
  // If no config, fallback to serverApi URL if it exists or default
  const baseURL = config?.server?.url || 'http://10.2.0.1:3030';
  const apiKey = config?.server?.api_key || '';

  return axios.create({
    baseURL,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    timeout: 30_000, // Timeout un po' più lungo per retrievals pesanti
  });
}

// ── API ────────────────────────────────────────────────────────────────────

export const aiTaskService = {

  /** List all AI tasks on the server */
  async listTasks(): Promise<ServerAiTask[]> {
    const { data } = await createClient().get<ServerAiTask[]>('/api/ai-tasks');
    return data;
  },

  /** Single task with latest execution included */
  async getTask(taskId: string): Promise<ServerAiTask> {
    const { data } = await createClient().get<ServerAiTask>(`/api/ai-tasks/${taskId}`);
    return data;
  },

  /** Create a new AI task */
  async createTask(payload: AiTaskCreatePayload): Promise<ServerAiTask> {
    const { data } = await createClient().post<ServerAiTask>('/api/ai-tasks', payload);
    return data;
  },

  /** Update an existing task */
  async updateTask(taskId: string, payload: AiTaskUpdatePayload): Promise<ServerAiTask> {
    const { data } = await createClient().put<ServerAiTask>(`/api/ai-tasks/${taskId}`, payload);
    return data;
  },

  /** Delete a task */
  async deleteTask(taskId: string): Promise<void> {
    await createClient().delete(`/api/ai-tasks/${taskId}`);
  },

  /** Pause a scheduled task */
  async pauseTask(taskId: string): Promise<void> {
    await createClient().post(`/api/ai-tasks/${taskId}/pause`);
  },

  /** Resume a paused task */
  async resumeTask(taskId: string): Promise<void> {
    await createClient().post(`/api/ai-tasks/${taskId}/resume`);
  },

  /** Run now — responds with 202 immediately */
  async runNow(taskId: string): Promise<void> {
    await createClient().post(`/api/ai-tasks/${taskId}/run`);
  },

  /** List executions of a task (most recent first) */
  async listExecutions(taskId: string): Promise<AiTaskExecution[]> {
    const { data } = await createClient().get<AiTaskExecution[]>(
      `/api/ai-tasks/${taskId}/executions`
    );
    return data;
  },

  /** GLOBAL list of archived executions */
  async listAllExecutions(limit: number = 100): Promise<AiTaskExecution[]> {
    const { data } = await createClient().get<AiTaskExecution[]>(
      `/api/ai-tasks/archives?limit=${limit}`
    );
    return data;
  },


  /** Text artifact of a specific execution */
  async getArtifact(taskId: string, execId: string): Promise<string> {
    const { data } = await createClient().get<string>(
      `/api/ai-tasks/${taskId}/executions/${execId}/artifact`,
      { responseType: 'text' }
    );
    return data;
  },

  /** Approve an output in needs_review */
  async approveExecution(taskId: string, execId: string): Promise<void> {
    await createClient().post(`/api/ai-tasks/${taskId}/executions/${execId}/approve`);
  },

  /** Delete a specific execution */
  async deleteExecution(execId: string): Promise<void> {
    await createClient().delete(`/api/ai-tasks/executions/${execId}`);
  },
};
