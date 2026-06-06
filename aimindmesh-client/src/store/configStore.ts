import { create } from 'zustand';
import { LogLevel } from '../utils/logger';

export interface AppConfig {
  server: { url: string; api_key: string };
  ollama: { auto_start: boolean; auto_stop_on_exit: boolean; model: string; preferred_routing: string };
  node: { id: string; name: string; vpn_ip: string };
  ui: { start_minimized: boolean; start_with_system: boolean; theme: string; search_enabled?: boolean };
  logging: { level: LogLevel };
  updates: { check_automatic: boolean };
  gemini: { apiKey: string; model: string };
  openrouter: { apiKey: string; model: string };
  freellmapi?: { enabled: boolean; baseUrl: string; apiKey: string; timeoutMs: number; model: string };
  autoEvolution: {
    enabled: boolean;
    giteaRepoOwner: string;
    giteaRepoName: string;
    giteaDeveloperUsername: string;
  };
}

interface ConfigState {
  config: AppConfig | null;
  setConfig: (c: AppConfig) => void;
}

export const useConfigStore = create<ConfigState>((set) => ({
  config: null,
  setConfig: (config) => set({ config }),
}));
