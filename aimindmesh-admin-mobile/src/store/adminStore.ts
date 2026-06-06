import { create } from 'zustand';
import { adminApi } from '../services/api';

interface ServerNode {
  id: string; type: string; status: string; url: string;
  models?: string[]; address?: string; version?: string;
}
interface ServerStatus {
  nodes: ServerNode[];
  cpu: number;
  ram: { total: string; used: string; percent: number };
  geminiUsage: number;
  openrouterUsage?: number;
  fcmStatus?: { configured: boolean; path: string };
  dailyQuotaCap?: number;
  openrouterDailyQuotaCap?: number;
  inferenceQueue?: any[];
  runningTasksCount?: number;
  queueHistory?: any[];
  activity?: any[];
  openrouterCredits?: {
    balance: number;
    total_credits: number;
    total_usage: number;
    lastChecked: number;
  } | null;
  infrastructureBrake: boolean;
  openClawHealth?: {
    isHealthy: boolean;
    statusMessage: string;
    lastCheck: number;
  };
  hermesHealth?: {
    isHealthy: boolean;
    statusMessage: string;
    lastCheck: number;
  };
  failedHistory?: any[];
}
interface ServerConfig {
  server?: { port: number; apiKey: string };
  proactive?: { 
    enabled: boolean; 
    intervalHours: number;
    relevanceThreshold: number;
    samplingLimit: number;
  };
  ollama?: { baseUrl: string; defaultModel: string; timeoutMs?: number };
  gemini?: { model: string; dailyQuotaCap: number; rpmLimit?: number };
  openrouter?: { 
    model: string; 
    dailyQuotaCap: number;
    creditCheckIntervalHours?: number;
    lowCreditThreshold?: number;
  };
  routing?: { 
    preferredNode: string;
    taskPriorities?: Record<string, string[]>;
  };
  wiki?: {
    enabled: boolean;
    syncIntervalHours: number;
    maxConceptsPerCycle: number;
  };
  autoEvolution?: {
    enabled: boolean;
    preferredNode?: string;
    maxProposalsPerDay?: number;
    minSeverityThreshold?: number;
    cronExpression?: string;
    shadowMode?: boolean;
  };
  freellmapi?: {
    enabled: boolean;
    baseUrl: string;
    apiKey: string;
    timeoutMs: number;
    model: string;
  };
}

interface AdminState {
  status: ServerStatus | null;
  config: ServerConfig | null;
  isLoading: boolean;
  error: string | null;
  ollamaRunning: boolean;
  openrouterModels: Record<string, string[]> | null;
  fetchStatus: () => Promise<void>;
  fetchConfig: () => Promise<void>;
  patchConfig: (newConfig: any) => Promise<void>;
  fetchCredits: () => Promise<void>;
  refreshCredits: () => Promise<void>;
  toggleBrake: (active: boolean) => Promise<void>;
  fetchFailedHistory: () => Promise<void>;
  clearFailedHistory: () => Promise<void>;
  init: () => Promise<void>;
}

export const useAdminStore = create<AdminState>((set, get) => ({
  status: null,
  config: null,
  isLoading: true,
  error: null,
  ollamaRunning: false,
  openrouterModels: null,

  fetchStatus: async () => {
    try {
      const res = await adminApi.getStatus();
      const nodes: ServerNode[] = (res.data.nodes || []).map((n: any) => ({
        ...n, 
        url: n.url || n.ollama_url || n.baseUrl || 'internal',
        address: n.address || n.url || n.ollama_url || n.baseUrl || '10.2.0.1'
      }));
      const serverNode = nodes.find(n => n.type === 'server' || n.id === 'SERVER_LOCAL');
      set(state => ({
        status: {
          ...(state.status || {}),
          ...res.data,
          nodes,
          cpu: res.data.cpu || 0,
          ram: res.data.ram || { total: '0GB', used: '0GB', percent: 0 },
          dailyQuotaCap: res.data.dailyQuotaCap || 10000000,
          // Explicitly preserve credits if not in response
          openrouterCredits: res.data.openrouterCredits || state.status?.openrouterCredits || null
        },
        ollamaRunning: !!serverNode && serverNode.status === 'ONLINE',
        error: null,
      }));

      // Also fetch history (Filtered to COMPLETED for main view)
      try {
        const histRes = await adminApi.getQueueHistory(40, 'COMPLETED');
        set(state => ({
          status: state.status ? { ...state.status, queueHistory: histRes.data.history || [] } : null
        }));
      } catch (e) {
        console.warn('Failed to fetch queue history', e);
      }

      // And fetch failed history
      get().fetchFailedHistory();

    } catch (e: any) {
      set({ error: e?.message || 'Connection failed' });
    }
  },

  fetchConfig: async () => {
    try {
      const res = await adminApi.getConfig();
      set({ 
        config: res.data.config,
        openrouterModels: res.data.openrouterModels || null
      });
    } catch { /* swallow */ }
  },

  patchConfig: async (newConfig: any) => {
    try {
      const res = await adminApi.patchConfig(newConfig);
      set({ config: res.data.config });
    } catch (e: any) {
      console.error('Failed to update config', e);
      throw e;
    }
  },

  fetchCredits: async () => {
    try {
      const res = await adminApi.getOpenRouterCredits();
      set(state => ({
        status: state.status ? { ...state.status, openrouterCredits: res.data.credits } : null
      }));
    } catch (e) { console.error('Failed to fetch credits', e); }
  },

  refreshCredits: async () => {
    try {
      const res = await adminApi.refreshOpenRouterCredits();
      set(state => ({
        status: state.status ? { ...state.status, openrouterCredits: res.data.credits } : null
      }));
    } catch (e) { console.error('Failed to refresh credits', e); }
  },
  
  toggleBrake: async (active: boolean) => {
    try {
      await adminApi.toggleBrake(active);
      set(state => ({
        status: state.status ? { ...state.status, infrastructureBrake: active } : null
      }));
    } catch (e) {
      console.error('Failed to toggle brake', e);
      throw e;
    }
  },

  fetchFailedHistory: async () => {
    try {
      const res = await adminApi.getQueueHistory(100, 'FAILED');
      set(state => ({
        status: state.status ? { ...state.status, failedHistory: res.data.history || [] } : null
      }));
    } catch (e) {
      console.error('Failed to fetch failed history', e);
    }
  },

  clearFailedHistory: async () => {
    try {
      await adminApi.clearQueueFailed();
      set(state => ({
        status: state.status ? { ...state.status, failedHistory: [] } : null
      }));
    } catch (e) {
      console.error('Failed to clear failed history', e);
    }
  },

  init: async () => {
    set({ isLoading: true, error: null });
    try {
      await Promise.all([get().fetchStatus(), get().fetchConfig(), get().fetchCredits()]);
    } finally {
      set({ isLoading: false });
    }
  },
}));
