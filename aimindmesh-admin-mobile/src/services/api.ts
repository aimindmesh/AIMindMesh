import axios from 'axios';
import { useSettingsStore } from '../store/settingsStore';

const api = axios.create({ timeout: 15000 });

api.interceptors.request.use((config) => {
  const { serverUrl, apiKey } = useSettingsStore.getState();
  if (serverUrl) config.baseURL = serverUrl.replace(/\/$/, '');
  if (apiKey)    config.headers['X-API-Key'] = apiKey;
  return config;
});

export const serverApi = api;

// ─── Admin APIs ────────────────────────────────────────────────────────────────
export const adminApi = {
  getStatus: () => api.get('/api/admin/status'),
  getConfig: () => api.get('/api/admin/config'),
  patchConfig: (data: any) => api.patch('/api/admin/config', data),
  getLogs: (params?: { limit?: number; module?: string; level?: string }) =>
    api.get('/api/admin/logs', { params }),
  triggerProactive: () => api.post('/api/admin/proactive/trigger', {}),
  pruneNodes: () => api.delete('/api/admin/nodes/prune', { data: {} }),
  refreshNodes: () => api.post('/api/admin/nodes/refresh', {}),
  pauseInference: (id: string) => api.post(`/api/admin/queue/pause/${id}`, {}),
  resumeInference: (id: string) => api.post(`/api/admin/queue/resume/${id}`, {}),
  cancelInference: (id: string) => api.delete(`/api/admin/queue/cancel/${id}`, { data: {} }),
  deleteTask: (id: string) => api.delete(`/api/admin/queue/item/${id}`, { data: {} }),
  updateInferenceRouting: (id: string, routing: string) => api.patch(`/api/admin/queue/${id}`, { routing }),
  getQueueHistory: (limit: number = 100, status?: string) => api.get('/api/admin/queue/history', { params: { limit, status } }),
  clearQueueFailed: () => api.delete('/api/admin/queue/failed', { data: {} }),
  clearQueueHistory: () => api.delete('/api/admin/queue/history', { data: {} }),
  retryInference: (id: string) => api.post(`/api/admin/queue/retry/${id}`, {}),
  restoreAllFailedTasks: () => api.post('/api/admin/queue/restore-all', {}),
  reprocessDebate: (limit: number = 20) => api.post('/api/admin/debate/reprocess', { limit }),
  mergeDebate: () => api.post('/api/admin/debate/merge', {}),
  getFcmLogs: (limit: number = 50) => api.get('/api/admin/fcm/logs', { params: { limit } }),
  getSyncLogs: (limit: number = 50) => api.get('/api/admin/sync/logs', { params: { limit } }),
  getTaskStats: (unit: 'hour' | 'day' | 'total' = 'hour', hours?: number) => api.get('/api/admin/stats/tasks', { params: { unit, hours } }),
  getExecutionHealth: (hours: number = 24) => api.get('/api/admin/stats/health', { params: { hours } }),
  getOpenRouterCredits: () => api.get('/api/admin/openrouter/credits'),
  refreshOpenRouterCredits: () => api.post('/api/admin/openrouter/credits/refresh', {}),
  toggleBrake: (active: boolean) => api.post('/api/admin/maintenance/brake', { active }),
};

export const wikiApi = {
  runCycle: () => api.post('/api/admin/wiki/trigger'),
};

export const evolutionApi = {
  getProposals: () => api.get('/api/evolution/proposals'),
  getCandidates: () => api.get('/api/evolution/candidates'),
  approveProposal: (id: string) => api.post(`/api/evolution/proposals/${id}/approve`),
  rejectProposal: (id: string) => api.post(`/api/evolution/proposals/${id}/reject`),
  runCycle: () => api.post('/api/evolution/cycle/run'),
  processCandidate: (id: string, options?: { routing?: string; model?: string }) =>
    api.post(`/api/evolution/candidates/${id}/process`, options || {}),
  getProtectedPaths: () => api.get('/api/evolution/protected-paths'),
  addProtectedPath: (path: string, reason: string) =>
    api.post('/api/evolution/protected-paths', { path, reason }),
  deleteProtectedPath: (path: string) =>
    api.delete(`/api/evolution/protected-paths/${encodeURIComponent(path)}`),
  deleteCandidate: (id: string) => api.delete(`/api/evolution/candidates/${id}`),
  deleteProposal: (id: string) => api.delete(`/api/evolution/proposals/${id}`),
};

export const kasmApi = {
  getStatus: () => api.get('/api/kasm/status'),
  getImages: () => api.get('/api/kasm/images'),
  createSession: (imageId?: string) => api.post('/api/kasm/sessions', { imageId }),
  destroySession: (id: string) => api.delete(`/api/kasm/sessions/${encodeURIComponent(id)}`, { data: {} }),
};

// ─── Document APIs ─────────────────────────────────────────────────────────────
export const documentApi = {
  getJobs: () => api.get<{ jobs: IngestionJob[] }>('/api/documents/jobs'),
  deleteJob: (jobId: string) => api.delete(`/api/documents/jobs/${jobId}`, { data: {} }),
  stopIngestion: () => api.post('/api/documents/ingest/stop'),
  stopAndClear: () => api.post('/api/documents/ingest/stop-and-clear'),
  restartIngestion: () => api.post('/api/documents/ingest/restart'),
  getDocuments: () => api.get<{ documents: KGDocument[] }>('/api/documents'),
  deleteDocument: (docId: string) => api.delete(`/api/documents/${docId}`, { data: {} }),
  deleteAll: () => api.delete('/api/documents', { data: {} }),
  // Upload a file as multipart form data
  uploadFile: (formData: FormData) =>
    api.post('/api/documents/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    }),
  // Ingest by URL
  ingestUrl: (url: string) =>
    api.post('/api/documents/ingest/url', { url }),
};

// ─── Interfaces ────────────────────────────────────────────────────────────────
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

export interface LogEntry {
  id?: string;
  timestamp: string;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  module: string;
  message: string;
}
