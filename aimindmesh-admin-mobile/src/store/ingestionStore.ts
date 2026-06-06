import { create } from 'zustand';
import { documentApi, IngestionJob, KGDocument } from '../services/api';

interface IngestionState {
  jobs: IngestionJob[];
  documents: KGDocument[];
  isLoading: boolean;
  isUploading: boolean;
  uploadProgress: number;
  fetchJobs: () => Promise<void>;
  fetchDocuments: () => Promise<void>;
  uploadFile: (file: File) => Promise<void>;
  ingestUrl: (url: string) => Promise<void>;
  deleteJob: (id: string) => Promise<void>;
  deleteDocument: (id: string) => Promise<void>;
  stop: () => Promise<void>;
  stopAndClear: () => Promise<void>;
  restart: () => Promise<void>;
}

export const useIngestionStore = create<IngestionState>((set, get) => ({
  jobs: [],
  documents: [],
  isLoading: false,
  isUploading: false,
  uploadProgress: 0,

  fetchJobs: async () => {
    set({ isLoading: true });
    try {
      const res = await documentApi.getJobs();
      set({ jobs: res.data.jobs || [] });
    } catch { /* swallow */ }
    finally { set({ isLoading: false }); }
  },

  fetchDocuments: async () => {
    try {
      const res = await documentApi.getDocuments();
      set({ documents: res.data.documents || [] });
    } catch { /* swallow */ }
  },

  uploadFile: async (file: File) => {
    set({ isUploading: true, uploadProgress: 0 });
    try {
      const form = new FormData();
      form.append('file', file);
      await documentApi.uploadFile(form);
      // Refresh after upload
      await get().fetchJobs();
    } finally {
      set({ isUploading: false, uploadProgress: 0 });
    }
  },

  ingestUrl: async (url: string) => {
    set({ isUploading: true });
    try {
      await documentApi.ingestUrl(url);
      await get().fetchJobs();
    } finally {
      set({ isUploading: false });
    }
  },

  deleteJob: async (id: string) => {
    await documentApi.deleteJob(id);
    set(s => ({ jobs: s.jobs.filter(j => j.id !== id) }));
  },

  deleteDocument: async (id: string) => {
    await documentApi.deleteDocument(id);
    set(s => ({ documents: s.documents.filter(d => d.id !== id) }));
  },

  stop:        async () => { await documentApi.stopIngestion(); await get().fetchJobs(); },
  stopAndClear:async () => { await documentApi.stopAndClear();  await get().fetchJobs(); },
  restart:     async () => { await documentApi.restartIngestion(); await get().fetchJobs(); },
}));
