import axios from 'axios';
import { useConfigStore } from '../store/configStore';

const api = axios.create();

// Add an interceptor to always read the updated configuration
// ✅ FIX — always return config, outside of everything
api.interceptors.request.use((config) => {
  const appConfig = useConfigStore.getState().config;

  if (appConfig?.server?.url) {
    config.baseURL = appConfig.server.url.replace(/\/$/, '');
  }

  if (appConfig?.server?.api_key) {
    config.headers['X-API-Key'] = appConfig.server.api_key;
  }

  return config; // ← ALWAYS
}, (error) => {
  return Promise.reject(error);
});

export const serverApi = api;

export interface CronJob {
  id: string;
  schedule: string;
  task: string;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
}

export const agentApi = {
  getStatus: () =>
    api.get<{ available: boolean; version: string; activeSessions: number; cronJobs: number; skills: string[] }>(
      '/api/agent/status',
    ),

  runTask: (prompt: string, sessionKey: string) =>
    api.post<{ reply: string; durationMs: number; usedModel?: string }>(
      '/api/agent/task',
      { prompt, sessionKey },
    ),

  getHistory: (sessionKey: string) =>
    api.get<Array<{ role: string; content: string; timestamp: string }>>(
      `/api/agent/sessions/${sessionKey}/history`,
    ),

  getSessionStatus: (sessionKey: string) =>
    api.get<{ active: boolean }>(`/api/agent/sessions/${sessionKey}/status`),

  clearSession: (sessionKey: string) =>
    api.delete(`/api/agent/sessions/${sessionKey}`),

  listSkills: () =>
    api.get<{ skills: Array<{ name: string; version: string; description: string; trigger: string }> }>(
      '/api/agent/skills',
    ),

  listCronJobs: () =>
    api.get<{ jobs: CronJob[] }>('/api/agent/cron'),

  createCronJob: (schedule: string, task: string) =>
    api.post<CronJob>('/api/agent/cron', { schedule, task }),

  deleteCronJob: (id: string) =>
    api.delete(`/api/agent/cron/${id}`),

  toggleCronJob: (id: string, enabled: boolean) =>
    api.patch<CronJob>(`/api/agent/cron/${id}`, { enabled }),

  getConfigFile: (filename: string) =>
    api.get<{ filename: string; content: string }>(`/api/agent/config/${filename}`),

  saveConfigFile: (filename: string, content: string) =>
    api.put(`/api/agent/config/${filename}`, { content }),

  getGoogleAuth: () =>
    api.get<OpenClawGoogleAuthConfig>('/api/agent/openclaw/google-auth'),

  setGoogleAuth: (payload: { mode: 'api_key' | 'oauth'; apiKey?: string; primaryModel?: string }) =>
    api.put<{ ok: boolean; mode: string; requiresRestart: boolean }>('/api/agent/openclaw/google-auth', payload),

  listWorkspaceFiles: () =>
    api.get<{ files: Array<{ name: string; path: string; isDirectory: boolean; size: number; mtime: string }> }>(
      '/api/agent/workspace/files',
    ),

  getWorkspaceFile: (filePath: string) =>
    api.get<{ path: string; content?: string; isText: boolean; size: number }>(
      '/api/agent/workspace/file',
      { params: { path: filePath } }
    ),

  saveWorkspaceFile: (filePath: string, content: string) =>
    api.put<{ ok: boolean }>(
      '/api/agent/workspace/file',
      { path: filePath, content }
    ),

  deleteWorkspaceFile: (filePath: string) =>
    api.delete<{ ok: boolean }>(
      '/api/agent/workspace/file',
      { params: { path: filePath } }
    ),

  downloadWorkspaceFile: (filePath: string) =>
    api.get<Blob>(
      '/api/agent/workspace/file',
      { params: { path: filePath, download: 'true' }, responseType: 'blob' }
    ),

  getHermesStatus: () =>
    api.get<{ available: boolean; version: string }>('/api/agent/hermes/status'),

  runHermesTask: (prompt: string, sessionKey: string) =>
    api.post<{ reply: string; durationMs: number }>('/api/agent/hermes/task', { prompt, sessionKey }),

  getHermesConfig: () =>
    api.get<{ configYaml: string; envFile: string }>('/api/agent/hermes/config'),

  saveHermesConfig: (configYaml: string, envFile: string) =>
    api.put<{ ok: boolean }>('/api/agent/hermes/config', { configYaml, envFile }),
};

export interface OpenClawGoogleAuthConfig {
  mode: 'api_key' | 'oauth';
  apiKeyMasked: string | null;
  hasApiKey: boolean;
  primaryModel: string;
}

export interface IngestionJob {
  id: string;
  status: 'PENDING' | 'EXTRACTING' | 'CHUNKING' | 'VECTORIZING' | 'INDEXING' | 'DONE' | 'ERROR' | 'SKIPPED' | 'CANCELLED';
  docId?: string;
  source: string;
  totalChunks: number;
  doneChunks: number;
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

export const documentApi = {
  getJobs: () =>
    api.get<{ jobs: IngestionJob[] }>('/api/documents/jobs'),

  deleteJob: (jobId: string) =>
    api.delete(`/api/documents/jobs/${jobId}`),

  triggerGiteaSync: () =>
    api.post('/api/admin/gitea/sync'),

  // Flow control
  stopIngestion: () =>
    api.post<{ ok: boolean; message: string }>('/api/documents/ingest/stop'),

  stopAndClearIngestion: () =>
    api.post<{ ok: boolean; message: string }>('/api/documents/ingest/stop-and-clear'),

  restartIngestion: () =>
    api.post<{ ok: boolean; message: string }>('/api/documents/ingest/restart'),

  // Document management
  getDocuments: () =>
    api.get<{ documents: KGDocument[] }>('/api/documents'),

  deleteDocument: (docId: string) =>
    api.delete(`/api/documents/${docId}`),

  deleteDocuments: (docIds: string[]) =>
    api.delete<{ ok: boolean; deleted: number }>('/api/documents/batch', { data: { docIds } }),

  deleteAllDocuments: () =>
    api.delete<{ ok: boolean; message: string }>('/api/documents'),
};


export interface ReleaseInfo {
  version: string;
  deb?: string;
  appimage?: string;
  apk?: string;
  timestamp: string;
}

export const releaseApi = {
  getVersions: () =>
    api.get<{ versions: { pc?: ReleaseInfo; android?: ReleaseInfo } }>('/api/releases'),
    
  getLatest: () =>
    api.get<{ pc: string; android: string }>('/api/releases/latest'),
};

export const adminApi = {
  pauseInference: (id: string) =>
    api.post<{ ok: boolean; status: string }>(`/api/admin/queue/pause/${id}`),

  resumeInference: (id: string) =>
    api.post<{ ok: boolean; status: string }>(`/api/admin/queue/resume/${id}`),

  cancelInference: (id: string) =>
    api.delete<{ ok: boolean; status: string }>(`/api/admin/queue/cancel/${id}`),
 
  updateInferenceRouting: (id: string, routing: string) =>
    api.patch<{ ok: boolean }>(`/api/admin/queue/${id}`, { routing }),

  getQueueHistory: (limit: number = 100, status?: string) =>
    api.get<{ history: any[] }>('/api/admin/queue/history', { params: { limit, status } }),

  deleteTask: (id: string) =>
    api.delete<{ ok: boolean }>(`/api/admin/queue/item/${id}`),

  clearQueueHistory: (status?: 'FAILED' | 'ALL') =>
    api.delete<{ ok: boolean }>('/api/admin/queue/history', { params: { status } }),

  retryInference: (id: string) =>
    api.post<{ ok: boolean }>(`/api/admin/queue/retry/${id}`),

  restoreAllFailedTasks: () =>
    api.post<{ ok: boolean }>('/api/admin/queue/restore-all'),

  getNodes: () =>
    api.get<{ nodes: Array<{ id: string; type: string; status: string; url?: string; name?: string }> }>('/api/nodes'),

  // Backup Management
  getBackups: () =>
    api.get<{ backups: Array<{ filename: string; size: number; createdAt: number }> }>('/api/admin/backups'),

  createBackup: () =>
    api.post<{ ok: boolean; filename: string }>('/api/admin/backups'),

  restoreBackup: (filename: string) =>
    api.post<{ ok: boolean; message: string }>('/api/admin/backups/restore', { filename }),

  deleteBackup: (filename: string) =>
    api.delete<{ ok: boolean }>(`/api/admin/backups/${filename}`),

  getBackupDownloadUrl: (filename: string) => {
    const appConfig = useConfigStore.getState().config;
    const baseUrl = appConfig?.server?.url?.replace(/\/$/, '') || '';
    return `${baseUrl}/api/admin/backups/download/${filename}?apiKey=${appConfig?.server?.api_key}`;
  },

  getTaskStats: (unit: 'hour' | 'day' = 'hour', hours?: number) =>
    api.get<{ stats: any[] }>('/api/admin/stats/tasks', { params: { unit, hours } }),

  getExecutionHealth: (hours: number = 24) =>
    api.get<{ health: any }>('/api/admin/stats/health', { params: { hours } }),
};

export const kasmApi = {
  getStatus: () =>
    api.get<{ enabled: boolean; baseUrl: string; activeSessions: number; sessions: any[] }>('/api/kasm/status'),

  createSession: (imageId?: string) =>
    api.post<{ kasm_id: string; kasm_url: string }>('/api/kasm/sessions', { imageId }),

  executeCommand: (kasmId: string, cmd: string) =>
    api.post<{ ok: boolean; result: any }>('/api/kasm/exec', { kasmId, cmd }),

  getScreenshot: (kasmId: string) =>
    api.get<{ screenshot: string }>(`/api/kasm/sessions/${kasmId}/screenshot`),

  getImages: () =>
    api.get<any[]>('/api/kasm/images'),

  destroySession: (kasmId: string) =>
    api.delete<{ success: boolean }>(`/api/kasm/sessions/${kasmId}`),
};
