import { create } from 'zustand';
import { adminApi } from '../services/api';

const LOG_MODULES = ['ProactiveEngine', 'DebateEngine', 'InferenceRouter', 'SearchService', 'InferenceRegistry', 'DocumentIngester'];
const LOG_LEVELS  = ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const;

export type LogTab = 'SYSTEM' | 'FCM' | 'SYNC';

interface LogsState {
  activeTab: LogTab;
  logs: any[];
  isLoading: boolean;
  moduleFilter: string | null;
  levelFilter: string | null;
  availableModules: string[];
  availableLevels: readonly string[];
  setActiveTab: (tab: LogTab) => void;
  setModuleFilter: (m: string | null) => void;
  setLevelFilter: (l: string | null) => void;
  fetch: () => Promise<void>;
  clear: () => void;
}

export const useLogsStore = create<LogsState>((set, get) => ({
  activeTab: 'SYSTEM',
  logs: [],
  isLoading: false,
  moduleFilter: null,
  levelFilter: null,
  availableModules: LOG_MODULES,
  availableLevels: LOG_LEVELS,

  setActiveTab: (activeTab) => {
    set({ activeTab, logs: [], moduleFilter: null, levelFilter: null });
    get().fetch();
  },
  setModuleFilter: (moduleFilter) => set({ moduleFilter }),
  setLevelFilter:  (levelFilter)  => set({ levelFilter }),
  clear: () => set({ logs: [] }),

  fetch: async () => {
    set({ isLoading: true });
    try {
      const { activeTab, moduleFilter, levelFilter } = get();
      
      if (activeTab === 'SYSTEM') {
        const res = await adminApi.getLogs({
          limit: 200,
          module: moduleFilter ?? undefined,
          level: levelFilter ?? undefined,
        });
        set({ logs: res.data.logs || [] });
      } else if (activeTab === 'FCM') {
        const res = await adminApi.getFcmLogs(100);
        set({ logs: res.data.logs || [] });
      } else if (activeTab === 'SYNC') {
        const res = await adminApi.getSyncLogs(100);
        set({ logs: res.data.logs || [] });
      }
    } catch { /* swallow */ }
    finally { set({ isLoading: false }); }
  },
}));
