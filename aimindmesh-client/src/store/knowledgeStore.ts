import { create } from 'zustand';
import { serverApi } from '../services/serverApi';
import { Logger } from '../utils/logger';

export type JobStatus = 'PENDING' | 'EXTRACTING' | 'CHUNKING' | 'VECTORIZING' | 'INDEXING' | 'DONE' | 'ERROR';

export interface DocumentInfo {
  id: string; 
  title: string; 
  url?: string; 
  date: number; 
  nodeCount: number;
  chunkCount?: number;
}

export interface UploadJob {
  id: string;
  status: JobStatus;
  progress: number;
  error?: string;
}

interface KnowledgeState {
  documents: DocumentInfo[];
  uploadJobs: UploadJob[];
  loading: boolean;
  isUploading: boolean;
  isSyncing: boolean;
  
  fetchDocuments: () => Promise<void>;
  pollJob: (jobId: string) => void;
  setIsUploading: (val: boolean) => void;
  setIsSyncing: (val: boolean) => void;
  deleteDocument: (id: string) => Promise<void>;
  deleteDocuments: (ids: string[]) => Promise<void>;
  deleteAllDocuments: () => Promise<void>;
  stopIngestion: () => Promise<void>;
  restartPool: () => Promise<void>;
  syncGitea: () => Promise<void>;
  purgeQueue: () => Promise<void>;
  clearHistory: () => Promise<void>;
}

const activeIntervals = new Map<string, number>();

export const useKnowledgeStore = create<KnowledgeState>((set, get) => ({
  documents: [],
  uploadJobs: [],
  loading: false,
  isUploading: false,
  isSyncing: false,

  setIsUploading: (val: boolean) => set({ isUploading: val }),
  setIsSyncing: (val: boolean) => set({ isSyncing: val }),

  fetchDocuments: async () => {
    set({ loading: true });
    try {
      const [docRes, jobRes] = await Promise.all([
        serverApi.get('/api/documents'),
        serverApi.get('/api/documents/jobs')
      ]);
      
      set({ 
        documents: docRes.data.documents || [],
        uploadJobs: (jobRes.data.jobs || []).filter((j: any) => j.status !== 'DONE' && j.status !== 'SKIPPED')
      });

      // Resume polling for any non-terminal jobs
      const state = get();
      state.uploadJobs.forEach(job => {
        if (job.status !== 'ERROR') {
          get().pollJob(job.id);
        }
      });

    } catch (err) {
      Logger.error('KnowledgeStore', 'Failed to load documents/jobs', err);
    } finally {
      set({ loading: false });
    }
  },

  deleteDocument: async (id: string) => {
    try {
      set({ isSyncing: true });
      await serverApi.delete(`/api/documents/${id}`);
      await get().fetchDocuments();
    } catch (err) {
      Logger.error('KnowledgeStore', `Failed to delete document ${id}`, err);
      throw err;
    } finally {
      set({ isSyncing: false });
    }
  },

  deleteDocuments: async (ids: string[]) => {
    try {
      set({ isSyncing: true });
      await serverApi.delete('/api/documents/batch', { data: { docIds: ids } });
      await get().fetchDocuments();
    } catch (err) {
      Logger.error('KnowledgeStore', 'Failed to batch delete documents', err);
      throw err;
    } finally {
      set({ isSyncing: false });
    }
  },

  deleteAllDocuments: async () => {
    try {
      set({ isSyncing: true });
      await serverApi.delete('/api/documents');
      await get().fetchDocuments();
    } catch (err) {
      Logger.error('KnowledgeStore', 'Failed to purge knowledge base', err);
      throw err;
    } finally {
      set({ isSyncing: false });
    }
  },

  stopIngestion: async () => {
    try {
      await serverApi.post('/api/documents/ingest/stop');
    } catch (err) {
      Logger.error('KnowledgeStore', 'Failed to stop ingestion', err);
    }
  },

  restartPool: async () => {
    try {
      await serverApi.post('/api/documents/ingest/restart');
    } catch (err) {
      Logger.error('KnowledgeStore', 'Failed to restart pool', err);
    }
  },

  syncGitea: async () => {
    try {
      await serverApi.post('/api/admin/gitea/sync');
    } catch (err) {
      Logger.error('KnowledgeStore', 'Failed to sync Gitea', err);
    }
  },

  purgeQueue: async () => {
    try {
      await serverApi.post('/api/documents/ingest/stop-and-clear');
      set({ uploadJobs: [] });
    } catch (err) {
      Logger.error('KnowledgeStore', 'Failed to purge queue', err);
    }
  },
  
  clearHistory: async () => {
    try {
      await serverApi.delete('/api/documents/jobs');
      set({ uploadJobs: [] });
    } catch (err) {
      Logger.error('KnowledgeStore', 'Failed to clear history', err);
    }
  },

  pollJob: (jobId: string) => {
    // Avoid duplicate intervals for the same job
    if (activeIntervals.has(jobId)) return;

    set(state => {
      const exists = state.uploadJobs.some(j => j.id === jobId);
      if (exists) return state;
      return {
        uploadJobs: [...state.uploadJobs, { id: jobId, status: 'PENDING', progress: 0 }]
      };
    });

    const interval = window.setInterval(async () => {
      try {
        const res = await serverApi.get(`/api/documents/jobs/${jobId}`);
        const job = res.data;

        if (job.status === 'DONE' || job.status === 'ERROR') {
          window.clearInterval(interval);
          activeIntervals.delete(jobId);

          if (job.status === 'ERROR') {
            set(state => ({
              uploadJobs: state.uploadJobs.map(j => 
                j.id === jobId ? { ...j, status: 'ERROR', error: job.error } : j
              )
            }));
            // Auto-remove error after 10s
            setTimeout(() => {
              set(state => ({
                uploadJobs: state.uploadJobs.filter(j => j.id !== jobId)
              }));
            }, 10000);
          } else {
            // Success
            set(state => ({
              uploadJobs: state.uploadJobs.filter(j => j.id !== jobId)
            }));
            await get().fetchDocuments();
          }
        } else {
          // Update progress
          set(state => ({
            uploadJobs: state.uploadJobs.map(j => 
              j.id === jobId ? { ...j, status: job.status, progress: job.progress } : j
            )
          }));
        }
      } catch (e) {
        window.clearInterval(interval);
        activeIntervals.delete(jobId);
        set(state => ({
          uploadJobs: state.uploadJobs.filter(j => j.id !== jobId)
        }));
      }
    }, 2000);

    activeIntervals.set(jobId, interval);
  }
}));
